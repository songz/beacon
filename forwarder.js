// The hostname beacon.amayz.dev maps to one port. This forwarder listens there and spreads requests across
// the two Java replicas, skipping one that refuses connections. A request that carries a finder cookie
// always lands on the same replica (hash of the cookie), so the per-finder token bucket, which lives in
// that replica's memory, counts every report from that finder. Everything else round-robins. Fifty lines
// of Node so the leader election has two real processes to elect between; a fleet's load balancer does
// the same job with a session-affinity rule.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const http = require('http');

const PORT = Number(process.env.PORT);
const TARGETS = [
  { id: 'A', port: Number(process.env.REPLICA_A_PORT) },
  { id: 'B', port: Number(process.env.REPLICA_B_PORT) },
];
let next = 0;

// ?replica=A|B pins a request (the page opens one log stream per replica and kills the leader by id).
// A finder id (header, else cookie) pins by hash so its token bucket sees every report. Else round-robin.
function pick(req) {
  const q = /[?&]replica=([AB])\b/.exec(req.url || '');
  if (q) return TARGETS.find(t => t.id === q[1]);
  const finder = req.headers['x-beacon-finder'] || (/(?:^|;\s*)beacon_finder=([A-Za-z0-9_-]{22})/.exec(req.headers.cookie || '') || [])[1];
  if (!finder) return TARGETS[next++ % TARGETS.length];
  let h = 0;
  for (const c of finder) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TARGETS[h % TARGETS.length];
}

function forward(req, res, target, attempt) {
  const headers = { ...req.headers };
  headers['x-forwarded-for'] = [headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
  const upstream = http.request({ host: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers }, up => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', err => {
    const other = TARGETS[(TARGETS.indexOf(target) + 1) % TARGETS.length];
    const pinned = /[?&]replica=[AB]\b/.test(req.url || '');
    if (attempt === 0 && !pinned && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET')) {
      console.log(`[Forwarder] replica ${target.id} ${err.code}, retrying on ${other.id}`);
      return forward(req, res, other, 1);
    }
    console.log(`[Forwarder] no replica answered ${req.method} ${req.url}: ${err.code}`);
    if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no replica available' }));
  });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  forward(req, res, pick(req), 0);
}).listen(PORT, '127.0.0.1', () => console.log(`[Forwarder] :${PORT} -> A:${TARGETS[0].port}, B:${TARGETS[1].port}`));
