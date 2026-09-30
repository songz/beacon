// The hostname beacon.amayz.dev maps to one port. This forwarder listens there and round-robins requests
// across the two Java replicas, skipping one that refuses connections. Forty lines of Node so the leader
// election has two real processes to elect between; a fleet would use its load balancer instead.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const http = require('http');

const PORT = Number(process.env.PORT);
const TARGETS = [
  { id: 'A', port: Number(process.env.REPLICA_A_PORT) },
  { id: 'B', port: Number(process.env.REPLICA_B_PORT) },
];
let next = 0;

function forward(req, res, target, attempt) {
  const headers = { ...req.headers };
  headers['x-forwarded-for'] = [headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
  const upstream = http.request({ host: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers }, up => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', err => {
    const other = TARGETS[(TARGETS.indexOf(target) + 1) % TARGETS.length];
    if (attempt === 0 && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET')) {
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
  const target = TARGETS[next++ % TARGETS.length];
  forward(req, res, target, 0);
}).listen(PORT, '127.0.0.1', () => console.log(`[Forwarder] :${PORT} -> A:${TARGETS[0].port}, B:${TARGETS[1].port}`));
