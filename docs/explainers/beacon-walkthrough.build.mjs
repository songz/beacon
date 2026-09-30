#!/usr/bin/env node
// Builds docs/explainers/beacon-walkthrough.json: the walkthrough of the live simulation at
// beacon.amayz.dev for the sequence-explainer skill. Content lives HERE; the JSON is its output; the
// HTML is generated from the JSON by the skill. Every code excerpt's line range is found by searching
// the file for an anchor string at build time, so an edit above an excerpt cannot leave a stale range.
// Re-run after editing this file or any cited source:
//   node docs/explainers/beacon-walkthrough.build.mjs && \
//   node ~/.claude/skills/sequence-explainer/scripts/generate.mjs docs/explainers/beacon-walkthrough.json --source-root .
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
const OUT = path.join(ROOT, 'docs/explainers/beacon-walkthrough.json');
const files = new Map();
const read = p => { if (!files.has(p)) files.set(p, fs.readFileSync(path.join(ROOT, p), 'utf8')); return files.get(p); };
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

/** Line number (1-based) on which the only occurrence of `anchor` starts (or, for `end`, ends). */
function lineOf(p, anchor, end = false) {
  const text = read(p);
  const first = text.indexOf(anchor);
  if (first < 0) throw new Error(`${p}: anchor not found: ${JSON.stringify(anchor)}`);
  if (text.indexOf(anchor, first + 1) >= 0) throw new Error(`${p}: anchor is not unique: ${JSON.stringify(anchor)}`);
  const at = end ? first + anchor.length - 1 : first;
  return text.slice(0, at).split('\n').length;
}

/** A code/documentation evidence entry whose lines run from the start anchor's line to the end anchor's line. */
function src(id, label, detail, p, startAnchor, endAnchor = startAnchor, kind = 'code') {
  const lines = [lineOf(p, startAnchor), lineOf(p, endAnchor, true)];
  if (lines[1] < lines[0]) throw new Error(`${id}: end anchor precedes start anchor`);
  const all = read(p).split('\n');
  if (all.at(-1) === '') all.pop();
  const excerpt = all.slice(lines[0] - 1, lines[1]).join('\n');
  return { id, kind, label, detail, path: p, lines, sha256: sha(p), excerpt };
}

const J = 'src/main/java/dev/amayz/beacon/';
const revision = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
const dirty = execSync('git status --porcelain -- src web forwarder.js schema.cql run.sh ecosystem.config.js README.md', { cwd: ROOT }).toString().trim();

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------
const evidence = [
  // The tab
  src('sim-header', 'Everything on the page lives in one tab', 'The first three lines of sim.js: items, finders and the owner are objects in this tab, against the real backend.', 'web/sim.js', '// The simulation. Three lost items', 'The server only ever sees public keys and ciphertext.'),
  src('sim-constants', 'The simulation\'s numbers', 'Six finders, finder 5 is spammy, 3 s between a well-behaved finder\'s reports of one item, 50 ms for the spammy one, the owner polls every 3 s over the last 5 epochs.', 'web/sim.js', 'const FINDER_COUNT = 6;', 'const LOOKBACK_EPOCHS = 5;'),
  src('sim-newfinder', 'A finder is a sprite with a random id', 'newFinder(n): 16 random bytes become the id the tab sends as X-Beacon-Finder; finder 5 is flagged spammy.', 'web/sim.js', 'function newFinder(n) {', 'spammy, 20/s'),
  src('sim-near', 'What "near" means on the field', 'Within RANGE (11 percent of the field) with the y axis scaled to the field\'s shape.', 'web/sim.js', 'function near(a, b)'),
  src('sim-maybereport', 'When a finder reports', 'Each frame, for each item in range, if the per-item gap has passed (3000 ms, or 50 ms for the spammy finder).', 'web/sim.js', 'function maybeReport(f, now) {', '    report(f, item);'),
  src('sim-report', 'The finder\'s report, end to end in the tab', 'keyFor on the shared item object, encryptReport, a packet with the first hex of the ciphertext, POST /api/reports with the X-Beacon-Finder headers, then the 201 or 429 verdict on the packet.', 'web/sim.js', 'async function report(f, item) {', '  } finally { f.inFlight--; }'),
  src('sim-additem', 'Minting an item', 'A 32-byte seed from getRandomValues, the share id derived from it, then publish().', 'web/sim.js', 'async function addItem(x, y) {', '  await refreshItemLabel(item, false);'),
  src('sim-publish', 'Publishing the key schedule', 'One public key per epoch from now to now + PUBLISHED_AHEAD, POSTed to /api/schedules/<shareId>.', 'web/sim.js', 'async function publish(item) {', 'if (r.ok) { item.publishedThrough'),
  src('sim-ownerpoll', 'The owner\'s poll', 'Key hashes for the last LOOKBACK_EPOCHS epochs of every item, one GET /api/reports, decryptReport per new report, showSeen for the newest.', 'web/sim.js', 'async function ownerPoll() {', 'if (fresh) packet(serverPos, ownerPos'),
  src('sim-showseen', 'The 📍 marker', 'showSeen places the marker at the decrypted x, y; the label counts seconds since the report.', 'web/sim.js', 'function showSeen(item, s) {', 'seen ${Math.max(0, Math.round'),
  src('sim-showhealth', 'The header reads /health', 'served-by comes from the X-Beacon-Replica response header, the leader from the JSON; the kill button uses the remembered leader id.', 'web/sim.js', 'async function showHealth() {', "$('replica').textContent = `served by"),
  src('sim-openlog', 'One SSE stream per replica', 'openLog(replica) opens EventSource /api/log?replica=A|B; a dropped stream prints a reconnecting line.', 'web/sim.js', 'function openLog(replica) {', 'es.onerror = () => appendLog'),
  src('sim-killleader', 'The kill button', 'POST /api/chaos/kill-leader?replica=<leader>, then the button sleeps 30 s.', 'web/sim.js', 'async function killLeader() {', 'setTimeout(() => { btn.disabled = false; }, 30000);'),
  src('sim-main', 'Page start', '/health supplies epochSeconds so the tab and server agree on the epoch length; two log streams; three items; six finders; the owner poll.', 'web/sim.js', 'async function main() {', '  setTimeout(ownerPoll, 1500);'),
  src('crypto-header', 'The protocol in ten lines', 'seed to share id and per-epoch scalar by HKDF; finder ECDH with an ephemeral key; owner ECDH from the other side.', 'web/crypto.js', '// The whole protocol, in the browser', 'ephemeral key per report, and a server that only ever sees public keys and ciphertext.'),
  src('crypto-consts', 'Epoch length and publish-ahead on the client', 'EPOCH_SECONDS is overwritten from /health; the tab publishes 30 epochs ahead.', 'web/crypto.js', 'let EPOCH_SECONDS = 60;', 'const PUBLISHED_AHEAD = 30;'),
  src('crypto-shareid', 'Share id from the seed', 'HKDF-SHA256(seed, "beacon-share-id"), 16 bytes, base64url.', 'web/crypto.js', 'async function shareIdFromSeed(seed) {', "return B64URL.encode(await hkdf(seed, 'beacon-share-id', 16));"),
  src('crypto-epochkey', 'One key pair per epoch', 'HKDF-SHA256(seed, "beacon-epoch-N") is the P-256 scalar; a minimal PKCS#8 wrapper lets WebCrypto compute the public point; SHA-256 of the 65-byte point is the key hash.', 'web/crypto.js', 'async function epochKey(seed, epoch) {', 'return { epoch, privateKey, publicKey, keyHash: B64URL.encode(keyHash) };'),
  src('crypto-encrypt', 'Finder side: encryptReport', 'Ephemeral P-256 pair, ECDH with the epoch public key, HKDF to AES-256-GCM, random 12-byte nonce; envelope = point (65) + nonce (12) + ciphertext and tag.', 'web/crypto.js', '// Finder side. Envelope', '  return envelope;'),
  src('crypto-decrypt', 'Owner side: decryptReport', 'Split the envelope, ECDH with the epoch private key and the ephemeral point, same HKDF, AES-GCM decrypt.', 'web/crypto.js', '// Owner side.', 'return JSON.parse(new TextDecoder().decode(plaintext));'),
  src('common-api', 'Every request from the tab', 'api(): fetch with optional JSON body and extra headers; returns ok, status, headers and parsed JSON.', 'web/common.js', 'async function api(method, path, body, headers = {}) {', 'return { ok: res.ok, status: res.status'),
  src('index-page', 'The page\'s markup', 'Header with served-by and leader, the field with the server box, the legend, the log panel with the kill button.', 'web/index.html', '<header class="top">', '<p class="status">both replicas stream their own lines over SSE'),
  // The forwarder
  src('fwd-header', 'Why the forwarder exists', 'One hostname, two replicas; finder affinity by cookie or header so a per-replica token bucket sees every report; a fleet\'s load balancer does the same with a session-affinity rule.', 'forwarder.js', '// The hostname beacon.amayz.dev maps to one port', 'the same job with a session-affinity rule.'),
  src('fwd-pick', 'pick(): ?replica=, else hash of the finder id, else round-robin', 'The affinity rule. The hash is h*31 + char code over the id, unsigned, mod 2.', 'forwarder.js', '// ?replica=A|B pins a request', '  return TARGETS[h % TARGETS.length];'),
  src('fwd-retry', 'Failover for unpinned requests', 'ECONNREFUSED or ECONNRESET on the first attempt retries once on the other replica unless the request carried ?replica=; otherwise 503.', 'forwarder.js', "  upstream.on('error', err => {", "res.end(JSON.stringify({ error: 'no replica available' }));"),
  src('ecosystem', 'Three pm2 processes', 'beacon.amayz.dev is the forwarder, beacon-a and beacon-b run run.sh A and B.', 'ecosystem.config.js', '// Three processes: the forwarder on the public port', "      args: 'B',"),
  src('run-sh', 'run.sh copies the jar per replica and execs the JVM', 'exec means pm2\'s SIGINT reaches the JVM\'s shutdown hook; the copy makes a rebuild safe under a running replica.', 'run.sh', '# Run a private copy of the jar', 'exec "$JAVA" -Xms256m -Xmx512m -XX:+UseZGC -jar "build/run/beacon-${REPLICA}.jar"'),
  // Java: HTTP layer
  src('main-virtual', 'Jetty serves every request on a virtual thread', 'config.useVirtualThreads = true; web/ is served from disk in the checkout, from the jar otherwise.', J + 'Main.java', 'Javalin app = Javalin.create(config -> {', 'config.http.defaultContentType'),
  src('main-health', '/health', 'Replica id, epoch and epoch length, the CqlSession count, leader and isLeader, the ZooKeeper connection state.', J + 'Main.java', 'app.get("/health", ctx -> ctx.json(Map.of(', '"uptimeSeconds"'),
  src('main-boot', 'Route wiring and the [Boot] line', 'Every route touches both holders while wiring; after start the log records CqlSession holder=1 of 1 and Curator holder=1 of 1.', J + 'Main.java', 'Api.routes(app, new CassandraStore());', 'replica, Cassandra.CONNECTS.get(), Zk.CONNECTS.get(), Epochs.SECONDS);'),
  src('main-shutdown', 'The shutdown hook', 'Release the latch first, then close the ZooKeeper client, then stop Jetty. pm2 stop and System.exit both land here.', J + 'Main.java', '// pm2 stop sends SIGINT', '}, "shutdown"));'),
  src('api-routes', 'The five routes and the rate-limit before-handler', 'POST and GET /api/schedules, a before-handler on POST /api/reports, POST and GET /api/reports, /api/whereami.', J + 'Api.java', 'static void routes(Javalin app, Store store) {', 'app.get("/api/whereami", Api::whereami);'),
  src('api-limits', 'Envelope size limits', 'MIN_CIPHERTEXT 93 = ephemeral point 65 + nonce 12 + GCM tag 16; MAX 2048.', J + 'Api.java', '/** ephemeral public key (65) + GCM nonce (12)', 'static final int MAX_CIPHERTEXT = 2048;'),
  src('api-publish', 'Api.publish', 'Validates 1..98 keys, each epoch inside now-1..now+97, each public key a 65-byte uncompressed point; one putSchedule.', J + 'Api.java', '/** Owner publishes the public key for each of the next epochs.', 'ctx.status(201).json(Map.of("shareId", shareId, "stored"'),
  src('api-current', 'GET /api/schedules/:shareId/current', 'The route a finder in another tab would call; the simulation does not.', J + 'Api.java', '/** Finder asks for the key of the current epoch.', '"publicKey", encode(key.get().publicKey())'),
  src('api-report', 'Api.report', 'keyHash must be a 43-character base64url SHA-256, ciphertext 93..2048 bytes; putReport; the [Report] log line names the key hash; 201.', J + 'Api.java', '/** Finder posts an opaque envelope', 'ctx.status(201).json(Map.of("stored", true'),
  src('api-fetch', 'Api.fetch', '1..98 h= parameters, each a key hash; store.reports; the [Fetch] log line with the elapsed milliseconds and whether the thread is virtual.', J + 'Api.java', '/** Owner fetches by key hash', '        ctx.json(out);'),
  // Java: Cassandra
  src('cass-holder', 'The CqlSession holder singleton', 'Initialization-on-demand holder: the JVM initializes Holder once, under the class-init lock, the first time session() runs.', J + 'Cassandra.java', 'Initialization-on-demand holder', '        return Holder.INSTANCE;'),
  src('cass-connect', 'connect(): one session, LOCAL_QUORUM', 'CONNECTS counts each build (anything above one is a bug); 10 s request timeout; schema applied at boot.', J + 'Cassandra.java', '    static CqlSession connect() {', '        return bootstrap;'),
  src('store-prepare', 'Prepared statements on the one session', 'CassandraStore prepares four statements on Cassandra.session(); reads return the newest 50 per hash.', J + 'CassandraStore.java', '    CassandraStore() {', 'selectReports = s.prepare('),
  src('store-putschedule', 'putSchedule: one unlogged batch', 'All rows share the share_id partition, so the batch is one write to one node.', J + 'CassandraStore.java', '    public void putSchedule(String shareId', '        Cassandra.session().execute(batch);'),
  src('store-putreport', 'putReport: one INSERT with a timeuuid', 'The TTL comes from the table default (7 days); the timeuuid gives newest-first order.', J + 'CassandraStore.java', '    public void putReport(byte[] keyHash', 'Cassandra.session().execute(insertReport.bind('),
  src('store-reports', 'reports(): the virtual-thread fan-out', 'One Callable per hash, newVirtualThreadPerTaskExecutor in try-with-resources, invokeAll keeps order and rethrows the first failure.', J + 'CassandraStore.java', '     * One partition read per hash, all in flight at once.', '"fetch failed: " + e.getCause(), e.getCause());\n        }\n        return out;'),
  src('store-reportsfor', 'reportsFor(): one partition read', 'SELECT ... WHERE key_hash = ? LIMIT 50; each row\'s timeuuid becomes an ISO timestamp.', J + 'CassandraStore.java', '    List<Report> reportsFor(String keyHash) {', 'list.add(new Report(at.toString()'),
  src('schema-reports', 'The reports and schedules tables', 'reports: partition key_hash, clustering ts DESC, TTL 7 days. schedules: partition share_id, clustering epoch, TTL 48 h.', 'schema.cql', '-- One partition per public-key hash', ') WITH default_time_to_live = 172800;'),
  src('schema-stats', 'The stats table', 'One row per epoch, written by the elected sweeper, overwritten each sweep.', 'schema.cql', '-- Written by the elected sweeper', ') WITH default_time_to_live = 604800;'),
  src('singleton-test', 'SingletonTest: 64 threads, one instance', 'Workers park on a CountDownLatch, are released together, and the distinct instances are counted; the production holder yields 1.', 'src/test/java/dev/amayz/beacon/SingletonTest.java', ' * The interview question, run against production code', 'assertEquals(1, sessions.size(), "distinct CqlSession instances");'),
  // Java: rate limiting
  src('tb-header', 'TokenBucket: what it is', 'Capacity tokens refilled at a steady rate, lazily on each call; one synchronized method is the whole concurrency story.', J + 'TokenBucket.java', ' * Token bucket: capacity tokens', 'critical section is a handful of arithmetic ops.'),
  src('tb-acquire', 'tryAcquire and secondsUntilNextToken', 'Refill, then take one token if there is one; Retry-After is ceil((1 - tokens) / refillPerSecond).', J + 'TokenBucket.java', '    /** Take one token if there is one. */', 'return (long) Math.ceil((1 - tokens) / refillPerSecond);'),
  src('tb-refill', 'Lazy refill', 'Credit the seconds elapsed since the last call, capped at capacity. No timer thread per bucket.', J + 'TokenBucket.java', '    /** Lazy refill:', '            lastRefillNanos = now;'),
  src('rl-header', 'Two buckets per report, in-process', 'Finder bucket 10 / 1 per second; IP bucket 100 / 20 per second as a backstop wide enough that one spammy finder cannot starve its neighbours. Each replica counts on its own.', J + 'RateLimit.java', ' * Two buckets per report.', 'counts on its own; the README says what changes in a fleet.'),
  src('rl-finderid', 'finderId(): header, else cookie, else mint a cookie', 'The 22-character X-Beacon-Finder header wins; with none, the replica mints a 30-day beacon_finder cookie.', J + 'RateLimit.java', '    /** The finder id: the header the page sends per sprite', '            ctx.cookie(cookie);'),
  src('rl-check', 'RateLimit.check', 'Look up both buckets, ask both for secondsUntilNextToken first so a rejection burns no token in the other, then tryAcquire; on failure 429 with Retry-After and skipRemainingHandlers.', J + 'RateLimit.java', '    /** Runs before POST /api/reports.', '            ctx.skipRemainingHandlers();'),
  src('rl-log', 'One [RateLimit] line per finder per second', 'Rejections within the same second are counted and folded into "(+N more 429s this second)".', J + 'RateLimit.java', '    /** A spammy finder is rejected 20 times a second', 'suppressed > 0 ? " (+" + suppressed'),
  // Java: ZooKeeper
  src('zk-holder', 'The Curator holder singleton', 'Same holder idiom as Cassandra; one CuratorFramework owns the ZooKeeper session: 6 s session timeout, namespace beacon.', J + 'Zk.java', '/** One CuratorFramework per process', '        client.start();'),
  src('leader-start', 'LeaderLatch on /beacon/leader', 'Each replica adds an ephemeral sequential node; the lowest is leader; the listener logs acquired and lost.', J + 'Leader.java', " * Leader election with Curator's LeaderLatch", 'Log.out("[Leader] replica %s joined the election at %s"'),
  src('leader-stop', 'Leader.stop(): release the latch now', 'Closing the latch deletes the ephemeral node at once instead of at session expiry.', J + 'Leader.java', '    /** Close the latch on shutdown', 'System.out.println("[Leader] latch released on shutdown");'),
  src('leader-isleader', 'Leader.isLeader()', 'latch.hasLeadership(), read on every sweeper tick and by the chaos route.', J + 'Leader.java', '    static boolean isLeader() {', 'return l != null && l.hasLeadership();'),
  src('sweeper-timer', 'The sweeper\'s timer', 'A single daemon thread named sweeper; tick at 5 s, then every 30 s, on both replicas.', J + 'Sweeper.java', ' * The job that must run on exactly one replica', 'TIMER.scheduleAtFixedRate(() -> tick(replicaId), 5, PERIOD_SECONDS, TimeUnit.SECONDS);'),
  src('sweeper-tick', 'tick(): leader does the work, follower logs a skip', 'isLeader() gates the scan; the [Sweep] line reports the count, the epochs and the milliseconds.', J + 'Sweeper.java', '    private static void tick(String replicaId) {', 'Log.out("[Sweep] failed on replica %s: %s", replicaId, e);'),
  src('sweeper-count', 'countPerEpoch and writeStats', 'SELECT ts FROM beacon.reports over the whole table, bucketed by epoch; one INSERT into beacon.stats per epoch with swept_by.', J + 'Sweeper.java', '    private static Map<Long, Integer> countPerEpoch() {', 'for (var e : perEpoch.entrySet()) s.execute(upsert.bind('),
  src('chaos', 'POST /api/chaos/kill-leader', '409 unless this replica is the leader, 429 inside the 30 s cooldown shared by all visitors, else log, answer, and System.exit(0) 300 ms later on a daemon thread.', J + 'Chaos.java', ' * The failover demo.', '            t.start();'),
  src('epochs', 'Epochs', 'EPOCH_SECONDS (60 in the demo) from the environment; an epoch number is floor(ms / 1000 / SECONDS), shared by owner, finder and server.', J + 'Epochs.java', " * The item's key rotates once per epoch.", 'return epochMillis / 1000 / SECONDS;'),
  src('stats-route', 'GET /api/stats', 'The read side of the sweeper: the last 8 epochs\' rows. The page does not call it.', J + 'Stats.java', '    static void routes(Javalin app) {', 'ctx.json(Map.of("epoch", now, "leader", Leader.current(), "rows", rows));'),
  src('logstream', 'GET /api/log over SSE', 'Each replica streams its own recent lines and then every new line; the forwarder\'s ?replica= is what lets the page open one per replica.', J + 'LogStream.java', ' * GET /api/log streams this replica\'s log lines', 'Log.out("[Log] stream opened, subscribers=%d"'),
  // Documentation
  src('readme-table', 'What is real Find My and what is toy', 'The README\'s contract table: what the demo keeps from the real protocol and what it shrinks.', 'README.md', '## What is real Find My and what is toy', '| The owner\'s devices share the seed through iCloud Keychain', 'documentation'),
  src('readme-threads', 'README: three kinds of thread', 'Jetty virtual threads per request, the fetch fan-out on virtual threads (160 to 290 ms sequential, 24 to 32 ms fanned out), the sweeper on one daemon thread.', 'README.md', '### Threads (', 'Nothing blocks on the HTTP thread that is not a parked virtual thread.', 'documentation'),
  src('readme-zk', 'README: the failover, measured', 'pm2 stop of the leader; the other replica acquired 764 ms later; a graceful stop releases the latch, a kill -9 waits for the 6 s session timeout.', 'README.md', '### ZooKeeper (', 'over. Both replicas\' `/health` show `leader`, `isLeader` and the ZooKeeper connection state.', 'documentation'),
  // Inference and illustration
  { id: 'inf-finder-local-key', kind: 'inference', label: 'The simulated finder reads the key from the item object, not from the server', detail: 'report() in sim.js calls keyFor(item, epochAt()) on the item it shares the tab with; it never calls GET /api/schedules/:shareId/current. That route exists for a finder in another tab, and in the real protocol the public key arrives over Bluetooth. Inferred from reading sim.js; the README\'s phrase "finders fetch the epoch key" describes the protocol, not this code path.' },
  { id: 'inf-page-calls', kind: 'inference', label: 'What the page calls and what it does not', detail: 'sim.js calls GET /health, POST /api/schedules/:shareId, POST and GET /api/reports, GET /api/log?replica=A|B (SSE) and POST /api/chaos/kill-leader?replica=. It never calls GET /api/schedules/:shareId/current, GET /api/stats or GET /api/whereami: those serve a finder in another tab, a stats reader and a finder without geolocation, none of which the simulation has. The sweep is visible on the page only through the [Sweep] lines in the log panel.' },
  { id: 'inf-replica-choice', kind: 'inference', label: 'Which replica an example lands on is an illustration', detail: 'The forwarder hashes each finder\'s random id, so which replica a given sprite meets is decided at page load. This walkthrough sends finder 2 to A and finder 5 to B, and lets the owner\'s unpinned calls land on A, purely to keep the pictures readable. Any real page may differ.' },
  { id: 'ill-values', kind: 'illustration', label: 'Synthetic example values', detail: 'Finder ids such as uVWWk-LpQ2…, the item 🎒 at x 31.2, y 44.0, key hash yfjwAmFx…, a 169-byte envelope, bucket levels like 0.5 of 10, and log lines quoted with counts are invented to match the code\'s formats. None is a captured value from the live system.' },
  { id: 'obs-live', kind: 'inference', label: 'One observation of the live page, 2026-09-30', detail: 'OBSERVATION_PLACEHOLDER' },
];

// ---------------------------------------------------------------------------------------------
// Components (boxes) and connections
// ---------------------------------------------------------------------------------------------
const TAB = 'Your browser tab (one page, one JavaScript process)';
const FWD = 'Forwarder (pm2 process beacon.amayz.dev, Node)';
const RA = 'Java replica A (pm2 beacon-a, one JVM on :18081)';
const RB = 'Java replica B (pm2 beacon-b, one JVM on :18082)';
const INFRA = 'Docker compose on 127.0.0.1';

const replica = (x, b) => [
  { id: `r${x}`, name: `Replica ${x.toUpperCase()}: Javalin HTTP (Api, Chaos, LogStream)`, kind: 'service', boundary: b, description: `The JVM's HTTP layer. Every request runs on a Jetty virtual thread. Validates shapes and sizes, never content. Answers /health with its own id, the leader id and its ZooKeeper state.`, evidence: ['main-virtual', 'api-routes', 'main-health'] },
  { id: `r${x}-bucket`, name: `Token buckets (${x.toUpperCase()})`, kind: 'module', boundary: b, description: `In-process ConcurrentHashMap of TokenBucket per finder id (10, refill 1/s) and per client IP (100, refill 20/s). Only this JVM's requests count against them, which is why the forwarder pins finders.`, evidence: ['rl-header', 'tb-header'] },
  { id: `r${x}-cql`, name: `CqlSession holder singleton (${x.toUpperCase()})`, kind: 'module', boundary: b, description: `Cassandra.session() returns Holder.INSTANCE: one CqlSession per process, built once under the class-init lock, lock-free afterwards. Every store call and the sweeper go through it.`, evidence: ['cass-holder', 'cass-connect', 'singleton-test'] },
  { id: `r${x}-curator`, name: `Curator client singleton + LeaderLatch (${x.toUpperCase()})`, kind: 'module', boundary: b, description: `Zk.client() is the same holder idiom around one CuratorFramework; Leader wraps a LeaderLatch on /beacon/leader and answers isLeader() and current().`, evidence: ['zk-holder', 'leader-start', 'leader-isleader'] },
  { id: `r${x}-fanout`, name: `Virtual-thread fetch fan-out (${x.toUpperCase()})`, kind: 'module', boundary: b, description: `CassandraStore.reports(): one virtual thread per key hash, invokeAll, executor closed per call. Turns 15 sequential partition reads into one round trip's worth of waiting.`, evidence: ['store-reports', 'store-reportsfor'] },
  { id: `r${x}-sweeper`, name: `Sweeper, leader-only (${x.toUpperCase()})`, kind: 'module', boundary: b, description: `One daemon thread ticking every 30 s. Does the count only when this replica's latch has leadership; otherwise logs a skip.`, evidence: ['sweeper-timer', 'sweeper-tick'] },
];

const components = [
  { id: 'tab', name: 'Browser tab: items 🎒🔑🚲, finders 📱, owner 🏠, log panel', kind: 'client', boundary: TAB, description: 'All the sprites are objects in ONE tab: the items hold their seeds, the finders encrypt, the owner decrypts. Nothing on the page is a second device; only HTTP requests leave the tab. web/sim.js drives it, web/crypto.js is the protocol.', evidence: ['sim-header', 'crypto-header', 'index-page', 'inf-page-calls'] },
  { id: 'fwd', name: 'Forwarder on :3018', kind: 'service', boundary: FWD, description: 'Fifty lines of Node behind myproxy. Pins ?replica=A|B requests, pins each finder id to one replica by hash, round-robins the rest, and retries an unpinned request once on the other replica when one refuses connections.', evidence: ['fwd-header', 'fwd-pick', 'fwd-retry', 'ecosystem'] },
  ...replica('a', RA),
  ...replica('b', RB),
  { id: 'cassandra', name: 'Cassandra (beacon.schedules, beacon.reports, beacon.stats)', kind: 'store', boundary: INFRA, description: 'One node, RF=1, LOCAL_QUORUM. schedules: public keys per (share_id, epoch), TTL 48 h. reports: ciphertext per (key_hash, ts DESC), TTL 7 days. stats: the sweeper\'s per-epoch counts. It never holds a seed, a private key or a plaintext location.', evidence: ['schema-reports', 'schema-stats', 'cass-connect'] },
  { id: 'zk', name: 'ZooKeeper (/beacon/leader)', kind: 'external', boundary: INFRA, description: 'Holds one ephemeral sequential node per live replica under /beacon/leader. The lowest is the leader. A node vanishes when its replica closes the latch or its 6 s session expires.', evidence: ['leader-start', 'zk-holder'] },
];

const perReplica = x => {
  const X = x.toUpperCase();
  return [
    { id: `c-fwd-${x}`, from: 'fwd', to: `r${x}`, label: `HTTP to 127.0.0.1 replica ${X}: by ?replica=${X}, by hash of the finder id, or round-robin`, evidence: ['fwd-pick'] },
    { id: `c-${x}-bucket`, from: `r${x}`, to: `r${x}-bucket`, label: 'before-handler on POST /api/reports', evidence: ['api-routes', 'rl-check'] },
    { id: `c-${x}-cql`, from: `r${x}`, to: `r${x}-cql`, label: 'CassandraStore calls Cassandra.session()', evidence: ['store-prepare'] },
    { id: `c-${x}-fanout`, from: `r${x}`, to: `r${x}-fanout`, label: 'GET /api/reports calls store.reports(hashes)', evidence: ['api-fetch'] },
    { id: `c-${x}-fanout-cql`, from: `r${x}-fanout`, to: `r${x}-cql`, label: 'one SELECT per key hash, all on the one session', evidence: ['store-reports'] },
    { id: `c-${x}-cql-cass`, from: `r${x}-cql`, to: 'cassandra', label: 'CQL over the driver\'s connection pool, LOCAL_QUORUM', evidence: ['cass-connect'] },
    { id: `c-${x}-sweeper-curator`, from: `r${x}-sweeper`, to: `r${x}-curator`, label: 'Leader.isLeader() on every tick', evidence: ['sweeper-tick', 'leader-isleader'] },
    { id: `c-${x}-sweeper-cql`, from: `r${x}-sweeper`, to: `r${x}-cql`, label: 'SELECT ts FROM beacon.reports; INSERT beacon.stats', evidence: ['sweeper-count'] },
    { id: `c-${x}-curator-zk`, from: `r${x}-curator`, to: 'zk', label: 'ZooKeeper session (6 s timeout); ephemeral sequential node under /beacon/leader', evidence: ['zk-holder', 'leader-start'] },
    { id: `c-${x}-curator`, from: `r${x}`, to: `r${x}-curator`, label: '/health reads Leader.current(); Chaos checks Leader.isLeader()', evidence: ['main-health', 'chaos'] },
  ];
};

const connections = [
  { id: 'c-tab-fwd', from: 'tab', to: 'fwd', label: 'fetch() over HTTPS; myproxy terminates TLS and hands the request to :3018', evidence: ['common-api', 'ecosystem'] },
  ...perReplica('a'),
  ...perReplica('b'),
];

// ---------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------
const profiles = [
  {
    id: 'finder', name: 'A well-behaved finder sprite 📱 (finder 2)',
    description: 'A stranger\'s phone that happens to pass a lost item. It wants to tell the owner where the item is without ever learning whose item it is, and without the server learning where it is either.',
    origin: 'newFinder(n) in web/sim.js: a sprite in the same tab as the items and the owner, with a random 16-byte id that the tab sends as the X-Beacon-Finder header on every report. It is not a login; the server never verifies it, it only uses it to pick a token bucket.',
    facts: [
      'Six finders exist; finders 0 to 4 report an item at most once every 3 s while within 11 percent of the field of it. Finder 5 is the spammy one.',
      'Synthetic values in this journey: finder 2, id uVWWk-LpQ2…, near the item 🎒 at x 31.2, y 44.0.',
      'The finder, the item and the owner are JavaScript objects in one page; the finder takes the item\'s public key from the item object directly, which stands in for hearing a Bluetooth advertisement.',
    ],
    evidence: ['sim-header', 'sim-newfinder', 'sim-constants', 'inf-finder-local-key', 'ill-values'],
  },
  {
    id: 'spammy', name: 'The spammy finder 📱 (finder 5, 20 reports a second)',
    description: 'The same code as any finder, with the report gap set to 50 ms. It is the load the rate limiter exists for: a client that does everything right except the volume.',
    origin: 'SPAMMY = 5 and SPAM_EVERY_MS = 50 in web/sim.js. Its id is random like every finder\'s, and the forwarder pins it to one replica by hashing that id.',
    facts: [
      'Up to 9 of its reports can be in flight at once (inFlight cap 8); each is a freshly encrypted envelope.',
      'Synthetic values in this journey: finder 5\'s id hashes to replica B; its finder bucket starts full at 10 tokens.',
      'The page\'s console shows every one of its 429s as an error; the page is judged by window.beaconStats, not the console.',
    ],
    evidence: ['sim-constants', 'sim-newfinder', 'inf-replica-choice', 'ill-values'],
  },
  {
    id: 'owner', name: 'The owner sprite 🏠 and its items',
    description: 'The person who lost the items. Holds the only copy of each item\'s seed, publishes public keys ahead of time, and asks the server for reports by key hash so it can decrypt them here, in the tab.',
    origin: 'addItem() and ownerPoll() in web/sim.js. The seed is 32 random bytes drawn when the item is minted and kept in the item object; there is no account and no other device. Close the tab and the items are gone.',
    facts: [
      'Three items at page load, up to six by clicking the field; each has its own seed and share id.',
      'Every 3 s the owner derives the key hashes of the last 5 epochs of every item, 15 hashes for 3 items, and fetches them in one request.',
      'Synthetic values in this journey: the owner\'s unpinned requests round-robin to replica A; a fetch of 15 hashes finds 20 reports in 8 ms.',
    ],
    evidence: ['sim-additem', 'sim-ownerpoll', 'sim-constants', 'inf-replica-choice', 'ill-values'],
  },
  {
    id: 'sweeper', name: 'The sweeper on the leader replica',
    description: 'A background job, not a person: every 30 s, count how many reports landed in each epoch and write the counts to beacon.stats. It must run on exactly one replica at a time.',
    origin: 'Sweeper.start(replicaId) in Main: a single daemon thread with a ScheduledExecutorService, ticking on both replicas at 5 s after boot and then every 30 s. Only the replica whose Curator LeaderLatch holds /beacon/leader does the work.',
    facts: [
      'Synthetic values in this journey: replica A holds the latch at the start; someone may press "kill the leader" on the page.',
      'The page shows this job only through the green [Sweep] and [Leader] lines in the log panel; it never calls GET /api/stats.',
      'A graceful stop hands leadership over in under a second (764 ms measured in the README); a kill -9 waits for the 6 s ZooKeeper session timeout.',
    ],
    evidence: ['sweeper-timer', 'leader-start', 'inf-page-calls', 'readme-zk', 'ill-values'],
  },
];

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------
const step = ({ id, title, what, why, active, connections = [], requires = [], produces = [], outcome = 'continue', result, evidence, next = [] }) =>
  ({ id, title, what, why, active, connections, requires, produces, outcome, result, evidence, next });
const go = (stepId, label, condition) => ({ step: stepId, label, condition });

const reportScenario = {
  id: 'report', name: 'A finder reports a sighting', description: 'The ordinary path: the finder encrypts in the tab, the forwarder pins it to a replica, the token bucket lets it through, and one row lands in Cassandra.', profiles: ['finder'], start: 'near',
  steps: [
    step({ id: 'near', title: 'Finder 2 wanders within range of 🎒',
      what: 'Every animation frame move() nudges finder 2 and maybeReport() tests near(finder, item): within 11 percent of the field\'s width, with the y axis scaled by 0.625 to match the field\'s shape. Finder 2 last reported 🎒 more than 3 s ago (REPORT_EVERY_MS), so report(finder 2, 🎒) starts. Nothing has left the tab yet.',
      why: 'Interview concept: none, this is the simulation\'s plumbing. It stands in for a phone hearing a Bluetooth advertisement; the server has no idea a finder is near anything.',
      active: ['tab'],
      requires: [
        { property: 'finder within RANGE of an item', status: 'present', value: '11 percent of the field; finder 2 is 6 percent from 🎒 (illustrative)', origin: 'near() in sim.js from the sprites\' positions', ifMissing: 'No report is made; the finder keeps wandering.' },
        { property: '3 s since this finder last reported this item', status: 'present', value: 'finder 2 last reported 🎒 4.1 s ago (illustrative)', origin: 'f.last, a per-item timestamp on the finder', ifMissing: 'maybeReport skips this frame; the spammy finder\'s gap is 50 ms instead of 3 s.' },
      ],
      result: 'report() runs; a well-behaved finder keeps at most 2 reports in flight (the inFlight guard).',
      evidence: ['sim-near', 'sim-maybereport', 'sim-report'], next: [go('key', 'Next', 'report() has started')] }),
    step({ id: 'key', title: 'Take the item\'s public key for the current epoch',
      what: 'report() calls keyFor(🎒, epochAt()). The epoch is floor(now / 60 s); the item object, which lives in the same tab, already holds or derives the key pair for it. The finder uses only the 65-byte public point and its SHA-256 hash. Because item and finder share the tab, the finder never calls GET /api/schedules/:shareId/current; that route exists for a finder in another tab, and is what a Bluetooth advertisement stands in for.',
      why: 'Interview concept: encryption. The public key is safe to hand to anyone. The private scalar for the epoch is derived from the seed and used only by the owner.',
      active: ['tab'],
      requires: [{ property: 'epoch key for the current epoch', status: 'present', value: 'epoch 29854321, key hash yfjwAmFx… (illustrative)', origin: 'HKDF-SHA256(seed, "beacon-epoch-N") in crypto.js, cached in item.keys', ifMissing: 'keyFor derives it on demand; there is no failure path in the tab.' }],
      produces: ['publicKey: 65 bytes starting 0x04', 'keyHash: base64url SHA-256 of the public key, 43 characters'],
      result: 'The finder holds a public key and its hash, and nothing that could decrypt.',
      evidence: ['crypto-epochkey', 'epochs', 'crypto-consts', 'inf-finder-local-key', 'api-current'], next: [go('encrypt', 'Next', 'the public key is in hand')] }),
    step({ id: 'encrypt', title: 'Encrypt the location in the tab',
      what: 'encryptReport() makes an ephemeral P-256 pair, runs ECDH with the item\'s epoch public key, feeds the shared secret through HKDF-SHA256 (info "beacon-report") into an AES-256-GCM key, and encrypts the JSON {item, x, y, finder, at} under a random 12-byte nonce. The envelope is ephemeral public point (65) + nonce (12) + ciphertext and tag. The packet that flies to the server box shows 🔒 and the first 12 hex characters of the envelope, never the coordinates.',
      why: 'Interview concept: encryption. Only the holder of the epoch private key can rerun the ECDH from the other side. The ephemeral private key is dropped after this call, so even the finder cannot decrypt its own report later.',
      active: ['tab'],
      produces: ['envelope: 169 bytes for this plaintext (illustrative; 93 is the minimum)', 'a 🔒 packet on the field with the first hex bytes of the ciphertext'],
      result: 'The plaintext location now exists only in this tab\'s memory.',
      evidence: ['crypto-encrypt', 'sim-report', 'api-limits'], next: [go('post', 'Next', 'the envelope is built')] }),
    step({ id: 'post', title: 'POST /api/reports leaves the tab and is pinned to one replica',
      what: 'api("POST", "/api/reports", {keyHash, ciphertext}) sends the envelope base64url-encoded with two headers: X-Beacon-Finder (the sprite\'s 22-character id) and X-Beacon-Finder-Name ("finder 2", for the log only). myproxy terminates TLS and hands the request to the forwarder, the Node process pm2 lists as beacon.amayz.dev. pick() sees the finder header, hashes it (h * 31 + char code, unsigned, mod 2) and picks replica A for finder 2 in this example; it appends the client address to X-Forwarded-For and proxies to 127.0.0.1:18081.',
      why: 'Interview concept: rate limiting. Token buckets live in each JVM\'s memory, so a finder must always meet the same bucket. The forwarder\'s hash is the session-affinity rule a fleet\'s load balancer would carry.',
      active: ['tab', 'fwd', 'ra'], connections: ['c-tab-fwd', 'c-fwd-a'],
      requires: [{ property: 'X-Beacon-Finder header', status: 'present', value: 'uVWWk-LpQ2… (illustrative), 22 base64url characters', origin: 'newFinder() minted it; the tab sends it on every report', ifMissing: 'The forwarder round-robins instead and the replica mints a beacon_finder cookie; a burst before the cookie exists could split across two buckets.' }],
      produces: ['HTTP request on replica A with X-Forwarded-For set'],
      result: 'Replica A\'s Javalin server takes the request on a virtual thread.',
      evidence: ['common-api', 'sim-report', 'fwd-pick', 'main-virtual', 'ecosystem', 'inf-replica-choice'], next: [go('bucket', 'Next', 'the request reached replica A')] }),
    step({ id: 'bucket', title: 'RateLimit.check charges two token buckets',
      what: 'A before-handler on POST /api/reports runs RateLimit.check. finderId() takes the header (it matches the 22-character pattern, so no cookie is minted). Two buckets come out of a ConcurrentHashMap: finder:<id> with capacity 10 refilling 1 per second, and ip:<client ip> with capacity 100 refilling 20 per second. Both answer 0 seconds until the next token, so tryAcquire() succeeds on each and the handler chain continues.',
      why: 'Interview concept: rate limiting. TokenBucket refills lazily inside one synchronized method by crediting the time elapsed since the last call, so there is no timer per bucket and the critical section is a few arithmetic ops.',
      active: ['ra', 'ra-bucket'], connections: ['c-a-bucket'],
      requires: [
        { property: 'finder bucket has at least 1 token', status: 'present', value: '10 of 10 before this report, 9 after (illustrative)', origin: 'TokenBucket.tryAcquire() after refill()', ifMissing: '429 with Retry-After; follow the spammy finder\'s journey.' },
        { property: 'IP bucket has at least 1 token', status: 'present', value: '100 of 100 (illustrative)', origin: 'the client IP from X-Forwarded-For, normalized by GeoIp.normalize', ifMissing: '429 as well; the IP bucket is the backstop for a whole NAT.' },
      ],
      produces: ['finder:uVWWk-LpQ2… bucket: 9 tokens', 'ip bucket: 99 tokens'],
      result: 'The request reaches Api.report.',
      evidence: ['api-routes', 'rl-check', 'rl-finderid', 'tb-acquire', 'tb-refill'], next: [go('validate', 'Next', 'both buckets had a token')] }),
    step({ id: 'validate', title: 'Api.report checks shapes only',
      what: 'The body\'s keyHash must be 43 base64url characters (a 32-byte SHA-256) and the decoded ciphertext must be 93 to 2048 bytes. The server does not parse, decrypt or verify the envelope. It cannot: it holds no private key.',
      why: 'Interview concept: encryption. This is the contract in the README\'s table: the server stores public keys and ciphertext and nothing else, so a breach of the server or its logs reveals no location.',
      active: ['ra'],
      requires: [{ property: 'ciphertext length 93..2048', status: 'present', value: '169 bytes (illustrative)', origin: 'MIN_CIPHERTEXT 93 = 65 + 12 + 16, MAX_CIPHERTEXT 2048', ifMissing: '400 "ciphertext must be 93..2048 bytes"; the tab counts neither a 201 nor a 429.' }],
      result: 'store.putReport(keyHash bytes, ciphertext) is called.',
      evidence: ['api-report', 'api-limits', 'readme-table'], next: [go('write', 'Next', 'sizes are valid')] }),
    step({ id: 'write', title: 'One INSERT into beacon.reports through the one CqlSession',
      what: 'CassandraStore.putReport binds the prepared INSERT INTO beacon.reports (key_hash, ts, ciphertext) with a fresh timeuuid and executes it on Cassandra.session(). session() returns Holder.INSTANCE: the JVM built that CqlSession exactly once, under the class-initialisation lock, the first time any route touched it at boot, and CONNECTS counts 1. The row lands in the partition for this key hash with the table\'s default TTL of 7 days, at LOCAL_QUORUM, which on the single dev node is one acknowledgement.',
      why: 'Interview concept: Cassandra and singleton. The partition key key_hash picks the node and the partition; the clustering column ts DESC keeps the newest report first with no sort at read time. A CqlSession owns a connection pool and threads, so two per process would be a resource bug; the holder idiom is lazy, thread-safe and lock-free after the first call, and SingletonTest proves it from 64 threads.',
      active: ['ra', 'ra-cql', 'cassandra'], connections: ['c-a-cql', 'c-a-cql-cass'],
      requires: [{ property: 'the CqlSession', status: 'present', value: 'Holder.INSTANCE, built once at boot; the [Boot] line says CqlSession holder=1 of 1', origin: 'Cassandra.session()', ifMissing: 'Cannot be missing after boot: the first touch builds it, and a failed connect fails the boot.' }],
      produces: ['Row in beacon.reports: key_hash = SHA-256(public key), ts = now, ciphertext = 169 opaque bytes, TTL 7 days', 'Log on A: [Report] finder 2 (uVWWk-Lp) · 169 B of ciphertext stored under key hash yfjwAmFx… · ip …'],
      result: 'Cassandra acknowledges the write.',
      evidence: ['store-putreport', 'cass-holder', 'cass-connect', 'schema-reports', 'singleton-test', 'main-boot'], next: [go('stored', 'Next', 'the write is acknowledged')] }),
    step({ id: 'stored', title: '201 back to the tab; the packet turns green',
      what: 'Api.report answers 201 {stored: true, bytes: 169}. The forwarder pipes the response back; the tab\'s report() increments stats.reports201 and, 700 ms into the packet\'s flight, rewrites its text to "201 stored 169 B" with the ok class. The counts line under the field ("N reports stored") and window.beaconStats update once a second.',
      why: 'Interview concept: none; this is how the page shows the outcome. What the server keeps is a ciphertext under a hash that changes every epoch, so nothing on the server ties this report to the next one from the same item.',
      active: ['tab', 'fwd', 'ra'], connections: ['c-tab-fwd', 'c-fwd-a'],
      produces: ['stats.reports201 + 1', 'Packet label: 201 stored 169 B'],
      outcome: 'success', result: 'The sighting is stored and only the owner\'s tab can ever read it; the owner\'s next poll picks it up.',
      evidence: ['sim-report', 'api-report'] }),
  ],
};

const spamScenario = {
  id: 'spam', name: 'The spammy finder meets the token bucket', description: 'Twenty reports a second from one finder: the first ten pass, then one a second passes and the rest get 429 with Retry-After.', profiles: ['spammy'], start: 'burst',
  steps: [
    step({ id: 'burst', title: 'Finder 5 fires a report every 50 ms',
      what: 'maybeReport uses SPAM_EVERY_MS (50) for finder 5 instead of 3000, so while it is within range of an item it starts a report 20 times a second; up to 9 can be in flight at once. Each one still encrypts a fresh envelope in the tab exactly like a well-behaved finder\'s.',
      why: 'Interview concept: rate limiting. The spammy finder is the load a rate limiter exists for: correct in every way except volume.',
      active: ['tab'],
      requires: [{ property: 'finder 5 within range of an item', status: 'present', value: '🔑 at 6 percent distance (illustrative)', origin: 'near() in sim.js', ifMissing: 'No burst; the spammy finder only spams items it is next to.' }],
      produces: ['20 encrypted envelopes per second, each with X-Beacon-Finder = finder 5\'s id'],
      result: 'Twenty POST /api/reports per second leave the tab.',
      evidence: ['sim-constants', 'sim-maybereport', 'sim-report'], next: [go('pin', 'Next', 'the burst is under way')] }),
    step({ id: 'pin', title: 'The forwarder pins every one of them to replica B',
      what: 'pick() hashes finder 5\'s id the same way each time, so every report from this sprite lands on the same replica: B in this example (a different random id may hash to A). The other five finders hash independently and may land on either replica.',
      why: 'Interview concept: rate limiting. Before this pin existed a burst round-robined across A and B, each JVM\'s bucket saw half the traffic, and one finder got 20 reports through before a 429 (CLAUDE.md records the bug). Affinity is what makes a per-process bucket count correctly.',
      active: ['tab', 'fwd', 'rb'], connections: ['c-tab-fwd', 'c-fwd-b'],
      requires: [{ property: 'same replica for the same finder id', status: 'present', value: 'hash(id) mod 2 = 1, so B (illustrative)', origin: 'pick() in forwarder.js', ifMissing: 'A finder without a header or cookie round-robins and each replica\'s bucket sees only half the burst.' }],
      result: 'Replica B\'s before-handler sees all 20 reports a second from this finder.',
      evidence: ['fwd-pick', 'fwd-header', 'rl-header', 'inf-replica-choice'], next: [go('check', 'Next', 'the reports arrive on B')] }),
    step({ id: 'check', title: 'RateLimit.check asks the bucket',
      what: 'For each report replica B looks up finder:<finder 5\'s id> (capacity 10, refill 1 per second) and ip:<client ip> (capacity 100, refill 20 per second). It first asks both buckets for secondsUntilNextToken(), so a rejection by one bucket burns no token in the other, then tryAcquire() on each. The finder bucket started full at 10 and refills 1 token per second, lazily, on each call.',
      why: 'Interview concept: rate limiting. A token bucket allows a burst up to its capacity and then a steady rate: here 10 reports at once and then 1 per second, against a client offering 20 per second.',
      active: ['rb', 'rb-bucket'], connections: ['c-b-bucket'],
      requires: [{ property: 'finder 5\'s bucket has at least 1 token', status: 'unknown', value: 'Choose below: the first 10 reports of the burst find tokens; from the 11th on the bucket is empty except for the 1 token that refills each second.', origin: 'TokenBucket.tryAcquire() after refill()', ifMissing: '429 with Retry-After.' }],
      result: 'Choose which report of the burst to follow.',
      evidence: ['rl-check', 'tb-acquire', 'tb-refill'],
      next: [
        go('pass', 'One of the first 10 in the burst', 'tokens >= 1 in the finder bucket and in the IP bucket'),
        go('reject', 'The 11th report, 50 ms later', 'the finder bucket is below 1 token; the IP bucket still has about 90'),
      ] }),
    step({ id: 'pass', title: 'Accepted: stored like any other report',
      what: 'tryAcquire() takes one token (10 to 9, and so on down), Api.report validates the sizes, and putReport writes the row through replica B\'s CqlSession holder. The tab shows "201 stored" and counts it.',
      why: 'Interview concept: rate limiting and Cassandra. A bucket does not punish a client for being fast; it caps the rate. The first 10 of a burst are legitimate by the bucket\'s definition.',
      active: ['rb', 'rb-bucket', 'rb-cql', 'cassandra'], connections: ['c-b-cql', 'c-b-cql-cass'],
      produces: ['finder 5\'s bucket: one token fewer', 'Row in beacon.reports under the item\'s current key hash'],
      outcome: 'success', result: '201 stored; the next report 50 ms later finds one token fewer.',
      evidence: ['rl-check', 'store-putreport', 'api-report'] }),
    step({ id: 'reject', title: 'Rejected: 429 with Retry-After',
      what: 'The finder bucket holds 0.5 tokens (illustrative), so secondsUntilNextToken() is ceil((1 - 0.5) / 1) = 1. check() answers 429 with Retry-After: 1 and {error: "rate limited", retryAfterSeconds: 1} and calls skipRemainingHandlers(), so Api.report never runs and nothing is written. The IP bucket is untouched, so the other five finders on the same IP keep flowing. logRejection prints one [RateLimit] line per finder per second and folds the rest into "(+17 more 429s this second)".',
      why: 'Interview concept: rate limiting. Retry-After is the bucket\'s own arithmetic; the once-a-second log line is the same idea applied to the log so a 20-per-second client cannot flood it. In a fleet the tokens and refill timestamp move to Redis or a Cassandra counter so every replica shares one count and no affinity is needed.',
      active: ['rb', 'rb-bucket'], connections: ['c-b-bucket'],
      requires: [{ property: 'finder 5\'s bucket has at least 1 token', status: 'missing', value: '0.5 of 10 (illustrative); refills to 1 in 500 ms', origin: 'TokenBucket.secondsUntilNextToken()', ifMissing: 'This step: 429, no write.' }],
      produces: ['HTTP 429, Retry-After: 1', 'Tab: the packet bounces red with "429 retry after 1 s"; stats.reports429 + 1', 'Log on B: [RateLimit] finder 5 spammy (…) throttled · 0.5/10 tokens, ip 100/100 · 429 retry in 1 s (+17 more 429s this second)'],
      outcome: 'blocked', result: 'Nothing is stored. The bucket refills one token per second, so the spammy finder gets about one report a second through and about nineteen 429s. Chrome logs each 429 fetch as a console error; that is by design.',
      evidence: ['rl-check', 'rl-log', 'tb-acquire', 'rl-header', 'sim-report'] }),
  ],
};

const ownerScenario = {
  id: 'owner-fetch', name: 'The owner publishes keys, fetches sightings and decrypts here', description: 'Mint an item, publish its public keys, then every 3 s ask for reports under 15 key hashes; the replica fans the reads out on virtual threads and the tab decrypts what comes back.', profiles: ['owner'], start: 'mint',
  steps: [
    step({ id: 'mint', title: 'Mint an item: a seed that never leaves the tab',
      what: 'addItem() draws 32 random bytes with crypto.getRandomValues and derives the share id, HKDF-SHA256(seed, "beacon-share-id"), 16 bytes as 22 base64url characters. Three items are minted at load; clicking the field mints up to six. The seed lives in the item object only: no localStorage, no other device.',
      why: 'Interview concept: encryption. Everything the item will ever publish is derived from this seed, and everything the owner will ever decrypt needs it. The server sees the share id and the public keys, never the seed.',
      active: ['tab'],
      produces: ['item.seed: 32 bytes, in the tab', 'item.shareId, e.g. Qm3xk_… (illustrative)'],
      result: 'publish(item) runs next.',
      evidence: ['sim-additem', 'crypto-shareid', 'crypto-header'], next: [go('publish', 'Next', 'the item exists in the tab')] }),
    step({ id: 'publish', title: 'Publish 31 public keys, one per epoch',
      what: 'publish() derives keys for the current epoch and the next 30 (PUBLISHED_AHEAD in crypto.js): each is HKDF-SHA256(seed, "beacon-epoch-N") as a P-256 scalar, wrapped in a minimal PKCS#8 structure and imported so WebCrypto computes the public point. The tab POSTs /api/schedules/<shareId> {keys: [{epoch, publicKey} × 31]}. There is no finder header, so the forwarder round-robins: replica A in this example. Api.publish checks each point is 65 bytes starting 0x04 and each epoch is inside now-1 .. now+97 (the server\'s own PUBLISHED_AHEAD is 96), then putSchedule writes all rows in one UNLOGGED batch to beacon.schedules with a 48-hour TTL. The label refresh republishes when fewer than 5 published epochs remain.',
      why: 'Interview concept: Cassandra and encryption. Every row shares the partition key share_id, so one batch is one write to one node; the clustering column epoch makes "the key for epoch N" a single-row read. The rows are public keys, safe to store anywhere.',
      active: ['tab', 'fwd', 'ra', 'ra-cql', 'cassandra'], connections: ['c-tab-fwd', 'c-fwd-a', 'c-a-cql', 'c-a-cql-cass'],
      requires: [{ property: 'epochs inside the publishable window', status: 'present', value: 'now .. now+30 (illustrative), inside now-1 .. now+97', origin: 'Epochs.current() on the server against epochAt() in the tab; both use EPOCH_SECONDS = 60, which the tab reads from /health at start', ifMissing: '400 "epoch N is outside the publishable window". A tab and a server that disagree on the epoch length never match key hashes either.' }],
      produces: ['31 rows in beacon.schedules (share_id, epoch, public_key), TTL 48 h', 'Log on A: [Schedule] share=… keys=31 epochs=N..N+30'],
      result: 'A finder in another tab could now GET the current key; in this tab the finders read it from the item directly.',
      evidence: ['sim-publish', 'crypto-epochkey', 'api-publish', 'store-putschedule', 'schema-reports', 'sim-main', 'epochs', 'inf-replica-choice'], next: [go('poll', 'Next', 'the schedule is stored')] }),
    step({ id: 'poll', title: 'Every 3 s: ask for reports under 15 key hashes',
      what: 'ownerPoll() runs every 3 s (OWNER_POLL_MS). For each of the 3 items it derives the key hashes of the current epoch and the 4 before it (LOOKBACK_EPOCHS 5), 15 hashes in all, and sends GET /api/reports?h=…&h=… with no finder header, so the forwarder round-robins; replica A in this example. Api.fetch accepts 1 to 98 hashes and checks each is 43 base64url characters.',
      why: 'Interview concept: encryption. The owner asks by hash of a public key. A hash reveals nothing about the item, and because it rotates every epoch the server cannot tell that two consecutive queries concern the same item.',
      active: ['tab', 'fwd', 'ra'], connections: ['c-tab-fwd', 'c-fwd-a'],
      requires: [{ property: 'at least one item minted', status: 'present', value: '3 items (illustrative)', origin: 'items[] in sim.js', ifMissing: 'ownerPoll returns without sending a request.' }],
      produces: ['GET /api/reports with 15 h= parameters'],
      result: 'Replica A\'s fetch handler runs on a Jetty virtual thread.',
      evidence: ['sim-ownerpoll', 'sim-constants', 'api-fetch', 'main-virtual', 'inf-replica-choice'], next: [go('fanout', 'Next', 'the request reached replica A')] }),
    step({ id: 'fanout', title: '15 partition reads at once on virtual threads',
      what: 'CassandraStore.reports() builds one Callable per hash, opens Executors.newVirtualThreadPerTaskExecutor() in a try-with-resources, and invokeAll()s the 15 tasks. Each task runs reportsFor(hash): SELECT ts, ciphertext FROM beacon.reports WHERE key_hash = ? LIMIT 50 on the one shared CqlSession. The 15 virtual threads park while the driver waits on the network and a few carrier threads serve them all; invokeAll keeps the answer order and rethrows the first failure; closing the executor joins everything, so nothing leaks across requests.',
      why: 'Interview concept: parallelism and singleton. The README measured the same fetch at 160 to 290 ms sequential and 24 to 32 ms fanned out. All 15 tasks share Holder.INSTANCE; a session per task would be the resource bug the holder prevents.',
      active: ['ra', 'ra-fanout', 'ra-cql', 'cassandra'], connections: ['c-a-fanout', 'c-a-fanout-cql', 'c-a-cql-cass'],
      produces: ['Map of key hash to newest-first reports, only for hashes with at least one row', 'Log on A: [Fetch] 15 key hashes in 8 ms on virtual threads · 20 reports found (illustrative numbers)'],
      result: 'The handler serialises the map as JSON.',
      evidence: ['store-reports', 'store-reportsfor', 'cass-holder', 'api-fetch', 'readme-threads'], next: [go('respond', 'Next', 'all 15 futures completed')] }),
    step({ id: 'respond', title: 'The reply carries ciphertext only',
      what: 'Api.fetch returns {<hash>: [{ts, ciphertext}, …]} with ts taken from the timeuuid and ciphertext base64url-encoded, and logs the count and the elapsed milliseconds. Back in the tab, ownerPoll skips any (ts, hash) pair it already decrypted on an earlier poll.',
      why: 'Interview concept: encryption. The reply is the whole of what the server knows: hashes, timestamps and opaque bytes.',
      active: ['ra', 'fwd', 'tab'], connections: ['c-fwd-a', 'c-tab-fwd'],
      requires: [{ property: 'a new report under one of the 15 hashes', status: 'unknown', value: 'Choose below.', origin: 'Whether a finder has passed an item and had its report accepted since the last poll', ifMissing: 'An empty map, or only entries seen before; nothing to decrypt.' }],
      result: 'Choose whether this poll found anything new.',
      evidence: ['api-fetch', 'sim-ownerpoll'],
      next: [
        go('decrypt', 'Reports found', 'the map has at least one (ts, hash) pair the tab has not decrypted yet'),
        go('nothing', 'Nothing new', 'the map is empty, or every entry was decrypted on an earlier poll'),
      ] }),
    step({ id: 'decrypt', title: 'Decrypt in the tab and drop a 📍',
      what: 'For each new report the tab takes the epoch private key it derived for that hash, splits the envelope into ephemeral point (65), nonce (12) and ciphertext, runs ECDH with the ephemeral point from the owner\'s side, HKDF-SHA256 with "beacon-report" into the same AES-256-GCM key, and decrypts to {item, x, y, finder, at}. showSeen() moves the 📍 marker to (x, y) with the label "🎒 seen 4s ago by finder 2" when the report is newer than the last one shown, and a packet "🔓 N decrypted here" flies from the server box to the owner.',
      why: 'Interview concept: encryption. The same ECDH secret is reached from the other side: the finder had (ephemeral private, epoch public), the owner has (epoch private, ephemeral public). A ciphertext that does not decrypt fails the GCM tag and is logged as "undecryptable" in the console, never shown.',
      active: ['tab'],
      requires: [{ property: 'epoch private key for the report\'s hash', status: 'present', value: 'derived from the seed in this tab; keyFor keeps the last 6 epochs\' keys per item', origin: 'keyFor(item, epoch) in sim.js', ifMissing: 'A tab or device without the seed cannot derive it, so it cannot decrypt. Sharing with family would wrap the seed once per recipient (README).' }],
      produces: ['📍 marker at the reported x, y with "seen Ns ago by finder K"', 'stats.sightings + N'],
      outcome: 'success', result: 'The owner knows where the item was seen. The server, the forwarder and the finder do not.',
      evidence: ['crypto-decrypt', 'sim-ownerpoll', 'sim-showseen'] }),
    step({ id: 'nothing', title: 'Nothing new: poll again in 3 s',
      what: 'The map is empty or every entry was seen before. ownerPoll returns without drawing anything; the 📍 marker keeps its last position and its "seen Ns ago" label counts up once a second.',
      why: 'Interview concept: none. A poll with no sightings is the normal case between finder passes; real Find My pushes nothing to the owner either, the owner\'s device queries.',
      active: ['tab'],
      requires: [{ property: 'a new report under one of the 15 hashes', status: 'missing', value: 'none in this poll', origin: 'the reports map from Api.fetch', ifMissing: 'This step.' }],
      outcome: 'waiting', result: 'The next ownerPoll fires in 3 s. It finds something once a finder within range has posted a report that its replica\'s bucket accepted.',
      evidence: ['sim-ownerpoll', 'sim-constants'] }),
  ],
};

const sweepScenario = {
  id: 'sweep', name: 'The leader sweeps; the leader dies', description: 'Both replicas tick every 30 s, only the latch holder counts. Follow the leader, the follower, or press the kill button and watch leadership move to the other replica while pm2 restarts the dead one.', profiles: ['sweeper'], start: 'tick',
  steps: [
    step({ id: 'tick', title: 'Both replicas tick every 30 s',
      what: 'At boot Sweeper.start schedules tick(replicaId) on a single-thread ScheduledExecutorService whose one thread is a daemon named "sweeper": first at 5 s, then every 30 s. Both JVMs run this timer; nothing about the timer knows who the leader is. The two ticks run concurrently and independently; the order the walkthrough narrates them in is not a runtime order.',
      why: 'Interview concept: parallelism. Three kinds of thread in this service, each chosen for its job: Jetty\'s virtual threads per request, the fetch fan-out\'s virtual threads per task, and this one platform daemon thread for a periodic job.',
      active: ['ra-sweeper', 'rb-sweeper'],
      result: 'tick() runs on each replica.',
      evidence: ['sweeper-timer', 'main-boot', 'readme-threads'], next: [go('leader-check', 'Next', 'the timers fire')] }),
    step({ id: 'leader-check', title: 'Leader.isLeader(): who holds the latch?',
      what: 'tick() calls Leader.isLeader(), which asks the Curator LeaderLatch whether this replica has leadership. At boot each replica joined the latch at /beacon/leader (Curator namespace "beacon", path /leader) through Zk.client(), the Curator holder singleton: one ephemeral sequential znode per replica, lowest sequence wins, and the ZooKeeper session behind it has a 6 s timeout. In this example A holds the latch.',
      why: 'Interview concept: ZooKeeper. Leader election is the one place the two replicas must agree, and ephemeral sequential nodes give that agreement without the replicas ever talking to each other.',
      active: ['ra-sweeper', 'ra-curator', 'rb-sweeper', 'rb-curator', 'zk'], connections: ['c-a-sweeper-curator', 'c-b-sweeper-curator', 'c-a-curator-zk', 'c-b-curator-zk'],
      requires: [{ property: 'this replica holds the latch', status: 'unknown', value: 'Choose below: A holds it in this example, B does not.', origin: 'LeaderLatch.hasLeadership()', ifMissing: 'The tick logs "[Sweep] skipped" and does nothing.' }],
      result: 'Choose which replica\'s tick to follow, or press the kill button.',
      evidence: ['sweeper-tick', 'leader-start', 'zk-holder', 'leader-isleader'],
      next: [
        go('count', 'Replica A, the leader', 'hasLeadership() is true on A'),
        go('skip', 'Replica B, a follower', 'hasLeadership() is false on B'),
        go('kill', 'Someone presses "kill the leader"', 'POST /api/chaos/kill-leader?replica=A arrives while A holds the latch'),
      ] }),
    step({ id: 'count', title: 'The leader scans beacon.reports and counts per epoch',
      what: 'countPerEpoch() runs SELECT ts FROM beacon.reports over the whole table on the CqlSession holder, turns each timeuuid into milliseconds and then into an epoch number (Epochs.at), and merges counts into a TreeMap. This is a full table scan: fine at toy scale, and called out in the README as the first thing that changes in a fleet, where the count moves to write time as a Cassandra counter incremented per report.',
      why: 'Interview concept: Cassandra. Every other query in the service hits one partition; this one deliberately does not, to make the contrast visible.',
      active: ['ra-sweeper', 'ra-cql', 'cassandra'], connections: ['c-a-sweeper-cql', 'c-a-cql-cass'],
      produces: ['Map epoch to report count for every epoch that still has rows (7-day TTL)'],
      result: 'writeStats() runs next.',
      evidence: ['sweeper-count', 'epochs', 'schema-reports'], next: [go('write-stats', 'Next', 'the scan finished')] }),
    step({ id: 'write-stats', title: 'Upsert beacon.stats and log the count',
      what: 'For each epoch writeStats() executes INSERT INTO beacon.stats (epoch, reports, swept_at, swept_by): one row per epoch, overwritten on every sweep, with the id of the replica that counted. The log line reads "[Sweep] replica A counted 143 reports across 6 epochs in 12 ms" (illustrative). GET /api/stats serves the last 8 epochs\' rows; the page does not call it, it shows the sweep through the log panel, which streams each replica\'s own lines over SSE.',
      why: 'Interview concept: ZooKeeper. The stats row is the visible proof that exactly one replica did the job: swept_by never flips between A and B except across a failover.',
      active: ['ra-sweeper', 'ra-cql', 'cassandra'], connections: ['c-a-sweeper-cql', 'c-a-cql-cass'],
      produces: ['Rows in beacon.stats keyed by epoch, swept_by = A', 'Log on A: [Sweep] replica A counted … (green in the panel)'],
      outcome: 'success', result: 'The leader\'s job is done for 30 s.',
      evidence: ['sweeper-count', 'schema-stats', 'stats-route', 'logstream', 'inf-page-calls'] }),
    step({ id: 'skip', title: 'The follower logs a skip',
      what: 'On B, isLeader() is false, so tick() logs "[Sweep] skipped on replica B, leader is A" (Leader.current() reads the leader\'s id from the latch) and returns. No Cassandra query runs on B.',
      why: 'Interview concept: ZooKeeper. The follower neither sleeps nor stops its timer; it checks leadership on every tick, so it takes over on its first tick after acquiring the latch with no extra coordination.',
      active: ['rb-sweeper', 'rb-curator', 'zk'], connections: ['c-b-sweeper-curator', 'c-b-curator-zk'],
      requires: [{ property: 'B holds the latch', status: 'missing', value: 'A holds it', origin: 'LeaderLatch.hasLeadership() on B', ifMissing: 'This step: skip and log.' }],
      produces: ['Log on B: [Sweep] skipped on replica B, leader is A'],
      outcome: 'waiting', result: 'B ticks again in 30 s. It does work only once its latch listener has fired isLeader(), which happens when A\'s ephemeral node disappears.',
      evidence: ['sweeper-tick', 'leader-start'] }),
    step({ id: 'kill', title: 'POST /api/chaos/kill-leader?replica=A',
      what: 'The tab\'s header polls /health every 3 s and remembers the leader id. Pressing the button sends POST /api/chaos/kill-leader?replica=A; the forwarder sees ?replica=A and pins the request to A (a pinned request never fails over). On A, Chaos checks Leader.isLeader() (409 if this replica is not the leader) and a 30 s cooldown shared by all visitors (429 if too soon), logs "[Chaos] leader A exiting on request from …", answers {killed: "A"}, and a daemon thread calls System.exit(0) 300 ms later. The button disables itself for 30 s.',
      why: 'Interview concept: ZooKeeper. This is the failover test from the README, run from the page instead of pm2 stop.',
      active: ['tab', 'fwd', 'ra', 'ra-curator'], connections: ['c-tab-fwd', 'c-fwd-a', 'c-a-curator'],
      requires: [
        { property: 'A is the leader', status: 'present', value: 'leader A, per /health', origin: 'Leader.isLeader() on the replica the request was pinned to', ifMissing: '409 "this replica is not the leader"; the tab appends "— kill refused: 409".' },
        { property: '30 s since the last kill by any visitor', status: 'present', value: 'last kill 2 min ago (illustrative)', origin: 'Chaos.LAST_KILL, per JVM', ifMissing: '429 "one kill per 30 s" with Retry-After.' },
      ],
      produces: ['Log on A: [Chaos] leader A exiting on request from …', 'Tab log: "— you pressed kill the leader (A); watch [Chaos] and [Leader] below"'],
      result: 'A\'s JVM begins exiting.',
      evidence: ['sim-killleader', 'sim-showhealth', 'fwd-pick', 'chaos'], next: [go('release', 'Next', 'System.exit(0) runs on A')] }),
    step({ id: 'release', title: 'A\'s shutdown hook releases the latch',
      what: 'System.exit runs the shutdown hook registered in Main: Leader.stop() closes the LeaderLatch, which deletes A\'s ephemeral znode now instead of at session expiry; then Zk.client().close() ends the ZooKeeper session and app.stop() stops Jetty. The log panel\'s stream for A drops and the tab prints "A (stream down, reconnecting)". Until pm2 restarts A, the forwarder gets ECONNREFUSED on A and retries an unpinned request once on B.',
      why: 'Interview concept: ZooKeeper. A graceful stop hands leadership over in well under a second; a kill -9 would leave the ephemeral node until the 6 s session timeout, and only then would B take over. run.sh execs the JVM so pm2\'s SIGINT reaches this hook too.',
      active: ['ra', 'ra-curator', 'zk', 'fwd'], connections: ['c-a-curator', 'c-a-curator-zk', 'c-fwd-a'],
      produces: ['ZooKeeper: A\'s ephemeral sequential node under /beacon/leader is gone', 'Log on A: [Main] replica=A shutting down; [Leader] latch released on shutdown', 'Forwarder log: [Forwarder] replica A ECONNREFUSED, retrying on B'],
      result: 'B\'s node now has the lowest sequence number.',
      evidence: ['main-shutdown', 'leader-stop', 'zk-holder', 'fwd-retry', 'sim-openlog', 'run-sh'], next: [go('acquire', 'Next', 'A\'s node is gone from ZooKeeper')] }),
    step({ id: 'acquire', title: 'B\'s LeaderLatch fires isLeader()',
      what: 'Curator\'s watch on the previous node fires on B; its LeaderLatchListener logs "[Leader] acquired by replica B". The README measured this at 764 ms after a pm2 stop. The tab\'s header, which polls /health every 3 s and is now answered by B, changes to "served by B · leader B".',
      why: 'Interview concept: ZooKeeper. No replica told B it was leader; the disappearance of A\'s ephemeral node did.',
      active: ['rb', 'rb-curator', 'zk'], connections: ['c-b-curator-zk', 'c-b-curator'],
      requires: [{ property: 'B\'s session with ZooKeeper alive', status: 'present', value: 'connected (the "zookeeper" field on /health)', origin: 'Zk.client().getZookeeperClient().isConnected()', ifMissing: 'With no live replica in the latch there is no leader; nothing sweeps until one reconnects.' }],
      produces: ['Log on B: [Leader] acquired by replica B', 'Header: served by B · leader B'],
      result: 'B\'s next sweeper tick will find hasLeadership() true.',
      evidence: ['leader-start', 'main-health', 'sim-showhealth', 'readme-zk'], next: [go('b-sweeps', 'Next', 'B holds the latch')] }),
    step({ id: 'b-sweeps', title: 'B\'s next tick does the sweep',
      what: 'Within 30 s B\'s tick sees isLeader() true and runs the same countPerEpoch() and writeStats() on B\'s own CqlSession holder; the stats rows now say swept_by = B.',
      why: 'Interview concept: ZooKeeper and singleton. The job moved replicas without any state moving: the sweeper reads everything it needs from Cassandra, and B already had its one session.',
      active: ['rb-sweeper', 'rb-curator', 'rb-cql', 'cassandra'], connections: ['c-b-sweeper-curator', 'c-b-sweeper-cql', 'c-b-cql-cass'],
      produces: ['Log on B: [Sweep] replica B counted …', 'beacon.stats rows with swept_by = B'],
      result: 'Meanwhile pm2 is restarting A.',
      evidence: ['sweeper-tick', 'sweeper-count'], next: [go('restart', 'Next', 'pm2 has noticed A\'s exit')] }),
    step({ id: 'restart', title: 'pm2 restarts A as a follower',
      what: 'pm2 sees beacon-a exit and starts run.sh A again, which copies the jar and execs a fresh JVM: about 15 s for the JVM plus the Cassandra connect. The new process touches Cassandra.session() and Zk.client() once each while wiring routes, joins the latch behind B, and logs "[Boot] replica A · CqlSession holder=1 of 1 · Curator holder=1 of 1 · epoch 60 s". The tab\'s EventSource for A reconnects on its own and the panel shows A\'s boot lines; A\'s sweeper ticks 5 s after boot and logs a skip.',
      why: 'Interview concept: singleton and ZooKeeper. The boot line is the singleton on record: two holders, each built exactly once per process, even though every route and the sweeper reach for them. A rejoins as a follower because B\'s node now has the lowest sequence; leadership does not bounce back.',
      active: ['ra', 'ra-cql', 'ra-curator', 'zk', 'cassandra'], connections: ['c-a-curator', 'c-a-curator-zk', 'c-a-cql', 'c-a-cql-cass'],
      requires: [{ property: 'Cassandra and ZooKeeper reachable at boot', status: 'present', value: '127.0.0.1:9042 and 127.0.0.1:2181 from docker compose', origin: '.env, loaded by run.sh', ifMissing: 'connect() throws, the boot fails, pm2 keeps restarting A; B stays leader.' }],
      produces: ['Log on A: [Boot] replica A · CqlSession holder=1 of 1 · Curator holder=1 of 1', 'Log on A: [Leader] replica A joined the election at /leader, then [Sweep] skipped on replica A, leader is B'],
      outcome: 'success', result: 'Two replicas again, B leading. The kill button re-enables after 30 s and the cooldown lets the next visitor do it again.',
      evidence: ['main-boot', 'cass-holder', 'zk-holder', 'ecosystem', 'run-sh', 'leader-start', 'sweeper-timer'] }),
  ],
};

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------
const doc = {
  version: 1,
  title: 'beacon: how strangers find a lost item without the server learning where it is',
  purpose: 'This system shows how a lost item can be found by strangers without the server ever learning where it is. Everything you see at beacon.amayz.dev runs in your one tab against the real backend: the items, the finders and the owner are sprites in the same page, and only encrypted reports, public keys and key hashes ever leave it.',
  scope: 'The live simulation as deployed by ecosystem.config.js and docker-compose.yml: one browser tab, the Node forwarder, two Java replicas, one Cassandra node and one ZooKeeper. Four journeys: a finder\'s report, the spammy finder\'s 429, the owner\'s publish-fetch-decrypt loop, and the leader\'s sweep with the kill-the-leader failover. Each step names the interview concept it shows: singleton, parallelism, Cassandra, ZooKeeper, rate limiting or encryption.',
  revision: `git ${revision}${dirty ? ' with uncommitted changes in: ' + dirty.replace(/\n/g, '; ') : ' (clean working tree for the cited files)'}`,
  limitations: [
    'Authored from reading the code at this revision. The steps are not a recorded trace of a live run; the one observation of the live page is labelled as such in the evidence.',
    'Which replica a finder lands on depends on the hash of its random id. The walkthrough sends finder 2 to A and finder 5 to B, and lets the owner\'s unpinned calls land on A, as an illustration.',
    'Timings quoted (fetch milliseconds, the 15 s pm2 restart, the 764 ms latch handover) come from the README and code comments, not from this artifact.',
    'Cassandra and ZooKeeper internals are described at the level of the code\'s comments and the README, not from their sources.',
  ],
  evidence,
  components,
  connections,
  profiles,
  scenarios: [reportScenario, spamScenario, ownerScenario, sweepScenario],
  labels: { profile: 'Start as', scenario: 'Follow this journey' },
};

// The live observation is written by the verification pass into docs/explainers/beacon-walkthrough.observation.txt;
// the placeholder stays if that file is absent so the build never invents a runtime claim.
const obsPath = path.join(ROOT, 'docs/explainers/beacon-walkthrough.observation.txt');
const obs = doc.evidence.find(e => e.id === 'obs-live');
obs.detail = fs.existsSync(obsPath) ? fs.readFileSync(obsPath, 'utf8').trim() : 'No observation recorded for this build; nothing here claims to have watched the live page.';
profiles[0].evidence.push('obs-live');

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}: ${evidence.length} evidence, ${components.length} components, ${connections.length} connections, ${profiles.length} profiles, ${doc.scenarios.length} scenarios`);
