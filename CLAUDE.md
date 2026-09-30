# beacon — guidance for Claude

## Keep this file alive

**Whenever you learn something non-obvious about this codebase during a session
— about how it's shaped, why a design choice exists, how a subsystem behaves,
or where a bug class lives — append it to the right section below before
ending the turn.** Stay at the altitude of enduring concepts; details that
will rot fast (line numbers, current implementations, in-flight state)
belong in commits or memory, not here.

## Architecture & behavior

- Java 21 on purpose (the interview's language), not the house Node default. Build with the
  Gradle wrapper (`./gradlew build`), JDK from `~/.local/jdk/jdk-21*`; no global install.
- The client is one page plus three plain scripts under `web/` with no build step, so an interviewer
  can read the crypto in the browser's view-source. Deliberate deviation from the React default.
- The page is a self-running simulation (owner decision 2026-09-29: no second device, no links to
  share): items, finders and the owner all live in one tab and talk to the real backend. The
  finder identity is the `X-Beacon-Finder` header per sprite; the cookie path exists only for
  clients that send no header. Epoch length is a server setting (`EPOCH_SECONDS`, 60 in the demo)
  that the page reads from `/health`; the client and server must agree or hashes never match.
- The log panel is two SSE streams, one per replica, because each JVM only knows its own log; the
  forwarder honours `?replica=A|B` for that and for the kill button. A pinned request does not fail
  over, by design.
- `web/` is served from disk when the process runs in the checkout and from the jar otherwise,
  so a page edit is live without a rebuild in dev but the fat jar still ships everything.
- The server never sees a seed or a plaintext location. Everything it stores is either a public
  key or a ciphertext; the README's "what is real Find My and what is toy" table is the contract.
- The git history is the walkthrough: one commit per concept, in the README's order. Keep new
  work in the same spirit (one readable commit, message a reader can follow).

## Gotchas — landmines and invariants worth checking first

- The shell exports `NODE_ENV=production`; irrelevant for Gradle but `run.sh` loads `.env` with
  `set -a` so PORT and REPLICA_* come from the file, never from the caller's environment.
- Never run a JVM straight off `build/libs/*.jar`: a rebuild overwrites the file under the running
  process and its next lazy class load throws `NoClassDefFoundError` (seen in the shutdown hook as
  `LeaderLatch$8`). `run.sh` copies the jar to `build/run/beacon-<replica>.jar` first for that reason.
- `System.out.printf` writes its pieces as separate writes and pm2 timestamps each one, so a formatted
  line lands as two log lines. Log through `Log.out` (format, then one println).
- The Cassandra driver warns "keyspace change at runtime" on a `USE`; every CQL statement names
  `beacon.<table>` instead and the session is built without a keyspace.
- The three pm2 processes are `beacon.amayz.dev` (forwarder), `beacon-a`, `beacon-b`; the errors module
  keys on those names. myproxy gates a fresh hostname behind the token wall until the mapping has
  `disableAuth: true` (set once for beacon.amayz.dev).
- Behind myproxy and the forwarder the client address arrives as an IPv4-mapped IPv6 string
  (`::ffff:127.0.0.1`); `GeoIp.normalize` strips that and the brackets Javalin adds, and every IP
  reaches the rate limiter and the geo lookup through it. Symptom of a regression: finders "seen in
  somewhere" and `[GeoIp] no answer for ip=::ffff:...` in the log.
- Rate-limit buckets are per JVM. The forwarder pins requests that carry the `beacon_finder` cookie to
  one replica by hashing the cookie; without that pin a burst round-robins and one finder gets 20
  reports before a 429. Requests without the cookie (the owner page) still alternate, which is what
  makes the header's "served by" flip. Test the limit through the public URL with a cookie jar.
- Javalin's SSE handler only engages when the request sends `Accept: text/event-stream`; a bare curl
  gets an empty 200 and looks like a broken route. `EventSource` sends the header; test with
  `curl -N -H 'Accept: text/event-stream'`.
- Chrome logs every 429 fetch as a console error, so the simulation shows hundreds of console errors
  by design (the spammy finder). Judge the page by `window.beaconStats`, not the console count.
