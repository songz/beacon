# beacon

Lose something, and let strangers tell you where it is, without the server ever learning where that is.
It is Apple's Find My offline-finding protocol at toy scale: rotating keys derived from one secret, a
finder who encrypts to today's public key, and a server that only ever stores public keys and ciphertext.
Java 21, Cassandra 5 and ZooKeeper, in about 900 lines, so each piece can be read in one sitting.

Live: https://beacon.amayz.dev

## What you see (nothing to do, nothing to share)

Open https://beacon.amayz.dev and watch for a minute. Everything runs in your tab against the real backend.

1. The tab mints three lost items (🎒 🔑 🚲), each with its own random seed kept in this tab, and publishes
   one public key per epoch for each of them. Every item shows the short hash of its current key and a
   countdown; keys rotate every **60 seconds** in the demo (real Find My: 15 minutes, the page says so),
   so you see the hash change while watching.
2. Six finders (📱) wander. When one passes an item it encrypts the item's position in the browser
   (ECDH P-256 with an ephemeral key, HKDF-SHA256, AES-256-GCM) and posts the ciphertext. A small packet
   flies to the server box showing the first bytes of the ciphertext, never the coordinates, and comes back
   marked `201 stored`.
3. The owner (🏠) fetches by key hash every 3 seconds, decrypts in the tab, and drops a 📍 "seen 4s ago by
   finder 2" marker on the item.
4. One finder is spammy: 20 reports a second. The token bucket lets 10 through and then answers 429; its
   packets bounce red while the other five keep flowing.
5. The right-hand panel streams both replicas' logs over server-sent events, the replica id first on every
   line. The header says `served by A · leader B`. Press **kill the leader**: the leader replica exits, the
   panel shows the other one acquire the latch within a second, and pm2 brings the dead one back in about
   15 seconds as a follower. One kill per 30 seconds, across all visitors.
6. Click the field to drop one more item.

Every visitor shares one backend, so the sweeper's counts include everyone; items are private to the tab
that minted them because only that tab holds the seed.

## What is real Find My and what is toy

| Real Find My | Here |
| --- | --- |
| AirTag broadcasts a rotating P-224 public key over Bluetooth every 15 minutes | The tab publishes one P-256 public key per 60-second epoch to the server, 30 epochs ahead |
| Nearby iPhones pick up the key, encrypt their location to it, upload to Apple | Simulated finders in the same tab fetch the epoch key and encrypt in the browser |
| Keys are derived from a master beacon key with a KDF and a counter | HKDF-SHA256(seed, epoch) becomes the private scalar; the seed never leaves the browser |
| Apple indexes reports by SHA-256 of the public key; the owner queries hashes | Same: reports are keyed by SHA-256(public key), the owner fetches up to 97 hashes |
| ECIES with the advertised key: ECDH, KDF, AES-GCM | ECDH P-256 with an ephemeral key, HKDF-SHA256, AES-256-GCM |
| Millions of finders, billions of reports, rate limits everywhere | Two JVM replicas, one Cassandra node, a token bucket per finder |
| The owner's devices share the seed through iCloud Keychain | The tab that minted the item holds the seed; close it and the item is gone |

The key schedule is deliberately simple: one HKDF call per epoch, no hierarchical derivation, no
secondary keys. The real protocol adds those for efficiency on a coin cell battery, not for security.

## The concepts, one commit each

Read the history in order; each commit is a working state with the explanation in its message.

### Singleton ([commit 4](https://github.com/songz/beacon/commit/6f664e5))

`CqlSession` and `CuratorFramework` are the two objects that must exist once per process: each owns a
connection pool and threads. Both are initialization-on-demand holders:

```java
private static final class Holder {
    static final CqlSession INSTANCE = connect();
}
static CqlSession session() { return Holder.INSTANCE; }
```

The JVM initializes a class exactly once, under the class-init lock, the first time it is touched, so
this is lazy, thread-safe, and lock-free after the first call. `SingletonTest` is the interview
question run against production code: 64 threads parked on a `CountDownLatch`, released together, and
the distinct instances counted. The bare null check from [commit 3](https://github.com/songz/beacon/commit/2a9e49b)
is kept as a disabled test; its message records the measured result, 64, 64 and 63 distinct instances
out of 64 threads in three runs.

### Threads ([commit 7](https://github.com/songz/beacon/commit/d9b1358))

Three kinds of thread, each chosen for its job:

- Jetty serves every request on a virtual thread (`useVirtualThreads`), so a blocked Cassandra call
  parks the request instead of pinning a pool thread.
- The owner's fetch of up to 97 key hashes fans out on a `newVirtualThreadPerTaskExecutor` with
  `invokeAll`, which keeps order and rethrows the first failure. Sequential it took 160 to 290 ms on
  the box; fanned out it takes 24 to 32 ms.
- The sweeper is a single-thread `ScheduledExecutorService`: one job every 30 seconds, one daemon thread.

Nothing blocks on the HTTP thread that is not a parked virtual thread.

### Rate limiting ([commit 5](https://github.com/songz/beacon/commit/4c4ab6c))

`TokenBucket`: capacity 10, refill 1 per second, refilled lazily inside one `synchronized tryAcquire`,
so there is no timer per bucket and the critical section is a few arithmetic ops. Each report is charged
to two buckets: the finder's (the `X-Beacon-Finder` header the page sends per sprite, or a cookie the
server mints when there is none) and the caller IP's, which is a wide backstop (100, refill 20 per
second) so one spammy finder cannot starve the five next to it in the same browser. An empty bucket
answers `429` with `Retry-After` in whole seconds. The spammy finder on the page is this in motion, and
the log coalesces its rejections to one line per second with a count.

Buckets live in the process, so each replica counts on its own. The forwarder pins a finder id to one
replica (a hash of the id picks A or B), so one finder's reports all meet the same bucket; a finder
without an id is still held by the IP bucket, per replica. The
fleet version keeps the same bucket math but stores tokens and the refill timestamp in Redis (one `EVAL`
script per request) or in Cassandra counters, so every replica sees one count and no affinity is needed.

### Cassandra ([commit 3](https://github.com/songz/beacon/commit/2a9e49b))

Three tables, every query by partition key:

```sql
reports   (key_hash blob, ts timeuuid, ciphertext blob, PRIMARY KEY (key_hash, ts))
          WITH CLUSTERING ORDER BY (ts DESC) AND default_time_to_live = 604800
schedules (share_id text, epoch bigint, public_key blob, PRIMARY KEY (share_id, epoch))
          WITH default_time_to_live = 172800
stats     (epoch bigint PRIMARY KEY, reports int, swept_at timestamp, swept_by text)
```

- The partition key (`key_hash`, `share_id`) picks the node and the SSTable partition. "Newest sightings
  for this key" and "today's key for this item" are each one partition read.
- The clustering key (`ts`, `epoch`) orders rows inside the partition. `ts DESC` means the newest report
  is the first row, no sort at read time.
- TTLs are table defaults. Reports vanish after 7 days and schedules after 48 hours without a delete
  job; the owner republishes while the page is open.
- Writes are cheap because Cassandra appends to a commit log and a memtable and never reads before
  writing. The 97-key publish is one unlogged batch since every row lands in the same partition.
- Consistency is `LOCAL_QUORUM` for reads and writes. On the single dev node that is one
  acknowledgement. At RF=3 the same code needs 2 of 3 replicas on both sides, so a read always overlaps
  a write's replicas and sees it. Nothing else changes: the keyspace gets
  `'replication_factor': 3` and the driver's local datacenter name.

The sweeper's full scan of `reports` is the one query that would not survive real volume. In a fleet
the count moves to write time, a Cassandra counter incremented per report, and the sweeper only reads.

### ZooKeeper ([commit 6](https://github.com/songz/beacon/commit/125ed16))

Two replicas run behind one hostname. Each joins a Curator `LeaderLatch` at `/beacon/leader`: an
ephemeral sequential znode per replica, lowest wins. Only the leader runs the 30-second sweep; the
other logs that it skipped and who the leader is. The page header shows `served by replica A · leader is B`.

Failover test, from the page: press **kill the leader**. `POST /api/chaos/kill-leader?replica=<leader>`
makes the leader exit; the panel shows the other replica's `[Leader] acquired` well under a second later,
and pm2 restarts the dead JVM (about 15 seconds: JVM boot plus the Cassandra connect) as a follower.
From the box, the same thing:

```
pm2 stop beacon-b            # B was leader
# beacon-a log, 764 ms later:  [Leader] acquired by replica A
pm2 restart beacon-b         # B rejoins as follower; A stays leader
```

A graceful stop releases the latch in the shutdown hook, so handover is sub-second. A `kill -9` leaves
the ephemeral node until the 6-second ZooKeeper session timeout expires, then the other replica takes
over. Both replicas' `/health` show `leader`, `isLeader` and the ZooKeeper connection state.

### Crypto ([commit 2](https://github.com/songz/beacon/commit/5c83385))

Everything is in `web/crypto.js`, WebCrypto only, about 90 lines.

- Seed: 32 random bytes in the owner's localStorage. Share id: `HKDF(seed, "beacon-share-id")`.
- Per epoch: `HKDF(seed, "beacon-epoch-" + epoch)` is the P-256 private scalar. The browser wraps it in a
  minimal PKCS#8 structure and imports it; WebCrypto computes the public point on import. The tab
  publishes the public points for the current and next 30 epochs; the server stores them under the share
  id (48-hour TTL) and hands out the current one to finders.
- Report: the finder makes an ephemeral P-256 pair, runs ECDH with the epoch key, derives an AES-256-GCM
  key with HKDF, and encrypts the location. The envelope is ephemeral public point (65 bytes), nonce
  (12), ciphertext and tag. The server checks that it is 93 to 2048 bytes and stores it under
  SHA-256(public key).
- Owner: derives the same epoch private key, ECDH with the ephemeral point in the envelope, decrypts.

Rotation means no stable identifier ties one item's reports together on the server: a fresh hash and a
fresh partition every epoch (every 60 seconds here, 96 a day in the real protocol). The server verifies
nothing about content, only sizes and rate.

What changes if the owner shares the item with family: today the epoch private key is the only thing
that decrypts, and only one browser can derive it. Sharing is envelope encryption: the finder's report
stays as it is, but the owner wraps the seed (or each epoch key) once per recipient with that person's
public key and publishes the wrapped copies. Each family member unwraps their copy with their own private
key and then decrypts reports exactly as the owner does. The report format, the server and the finder
never change; only the key distribution does.

Proof the server cannot read a report, from the box (the plaintext is `{"item":"🎒","x":31.2,"y":44.0,...}`):

```
cqlsh> SELECT ciphertext FROM beacon.reports LIMIT 1;
 0x04fdf952a0d668028c99a2c2270e454c6d36a8ab82...   (169 bytes, no structure)
$ grep -c '"x":' ~/Apps/prod-logs/beacon-*.log
0
```

## Run it locally

```
docker compose up -d      # cassandra:5 capped at 1G heap, zookeeper:3.9, both on 127.0.0.1 only
./gradlew run             # one replica on :8080 with PORT unset; REPLICA_ID defaults to A, epochs 60 s (EPOCH_SECONDS)
./gradlew test            # SingletonTest (64 threads) and TokenBucketTest
```

Needs Java 21 (the Gradle wrapper finds it through `JAVA_HOME` or a toolchain). The first Cassandra
boot takes about a minute; the app creates the keyspace and tables at startup.

Two replicas plus the forwarder, the way the live site runs:

```
./gradlew build
pm2 start ecosystem.config.js   # beacon.amayz.dev (forwarder :3018), beacon-a :18081, beacon-b :18082
```

`run.sh` starts each JVM with `-Xms256m -Xmx512m -XX:+UseZGC`. ZGC keeps pauses in the sub-millisecond
range so a garbage collection can never outlive the ZooKeeper session and cause a false leader change,
and a small fixed heap lets two replicas and Cassandra share one box. `run.sh` also copies the jar per
replica, because a rebuild that overwrites the jar under a running JVM breaks its lazy class loading.

Logs are one line per event with a tag: `[Report]`, `[Fetch]`, `[Schedule]`, `[Leader]`, `[Sweep]`,
`[RateLimit]`, `[Cassandra]`, `[Zk]`. `pm2 logs beacon-a` while you click around is the demo.

## Layout

```
web/            index.html, sim.js (items, finders, owner, log panel), crypto.js (the protocol), common.js
src/main/java/dev/amayz/beacon/
  Main          routes, static files, shutdown hook
  Api           validation and the five JSON endpoints
  LogStream     /api/log, each replica's log over server-sent events
  Chaos         /api/chaos/kill-leader, the failover button
  Cassandra     the CqlSession holder singleton and schema apply
  CassandraStore  the three tables, the virtual-thread fan-out
  Zk, Leader    the CuratorFramework holder and the LeaderLatch
  Sweeper, Stats  the elected 30-second job and its read side
  TokenBucket, RateLimit
  GeoIp         IP to city for finders without geolocation
src/test/java/dev/amayz/beacon/  SingletonTest, TokenBucketTest
schema.cql      the data model, applied at boot
forwarder.js    round-robin over the two replicas on the public port
```

Tested in Chrome. The PKCS#8 import that derives the public point from a scalar is standard WebCrypto
and should work in Firefox and Safari, but only Chrome has been driven end to end. The page is one HTML
file, one stylesheet and three scripts with no build step, so view-source shows the whole client.
