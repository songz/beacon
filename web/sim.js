// The simulation. Three lost items, six finders, one owner, all in this tab, against the real backend.
// Items own a seed and publish public keys; finders encrypt to today's key and post; the owner fetches by
// key hash and decrypts here. The server only ever sees public keys and ciphertext.

const ITEM_EMOJI = ['🎒', '🔑', '🚲', '🎧', '☂️', '📷'];
const MAX_ITEMS = 6;
const FINDER_COUNT = 6;
const SPAMMY = 5;               // index of the finder that reports 20 times a second
const RANGE = 11;               // percent of the field
const REPORT_EVERY_MS = 3000;   // a well-behaved finder reports an item it is near every 3 s
const SPAM_EVERY_MS = 50;       // the spammy one: 20 a second
const OWNER_POLL_MS = 3000;
const LOOKBACK_EPOCHS = 5;      // the owner checks the last 5 epochs' key hashes per item
const MAX_PACKETS = 40;

const field = $('field');
const items = [];
const finders = [];
const seen = new Map();         // item -> { x, y, finder, ts, el }
const stats = { reports201: 0, reports429: 0, rotations: 0, sightings: 0, publishes: 0 };
window.beaconStats = stats;     // read by the verification script
let packetsAlive = 0;
let leader = '?';

// ---------- sprites ----------

function sprite(cls, emoji, x, y) {
  const el = document.createElement('div');
  el.className = `sprite ${cls}`;
  el.innerHTML = `<div class="glyph">${emoji}</div><div class="label"></div>`;
  place(el, x, y);
  field.appendChild(el);
  return el;
}

function place(el, x, y) { el.style.left = `${x}%`; el.style.top = `${y}%`; }

function label(el, text, flash) {
  const l = el.querySelector('.label');
  l.textContent = text;
  if (flash) { l.classList.add('flash'); setTimeout(() => l.classList.remove('flash'), 1500); }
}

function packet(from, to, text, cls, done) {
  if (packetsAlive >= MAX_PACKETS) return null;
  packetsAlive++;
  const el = document.createElement('div');
  el.className = `packet ${cls || ''}`;
  el.textContent = text;
  place(el, from.x, from.y);
  field.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => place(el, to.x, to.y)));
  setTimeout(() => {
    if (done) done(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => { el.remove(); packetsAlive--; }, 300); }, 900);
  }, 750);
  return el;
}

const serverPos = { x: 92, y: 12 };
const ownerPos = { x: 8, y: 88 };

// ---------- items: seed, share id, key schedule ----------

async function addItem(x, y) {
  if (items.length >= MAX_ITEMS) return;
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const item = {
    emoji: ITEM_EMOJI[items.length % ITEM_EMOJI.length],
    seed, shareId: await shareIdFromSeed(seed), x, y,
    keys: new Map(), publishedThrough: -1, el: null, hash: '',
  };
  item.el = sprite('item', item.emoji, x, y);
  items.push(item);
  await publish(item);
  await refreshItemLabel(item, false);
  return item;
}

async function keyFor(item, epoch) {
  let k = item.keys.get(epoch);
  if (!k) { k = await epochKey(item.seed, epoch); item.keys.set(epoch, k); }
  for (const e of item.keys.keys()) if (e < epoch - LOOKBACK_EPOCHS - 1) item.keys.delete(e);
  return k;
}

async function publish(item) {
  const now = epochAt();
  const keys = [];
  for (let e = now; e <= now + PUBLISHED_AHEAD; e++) keys.push({ epoch: e, publicKey: B64URL.encode((await keyFor(item, e)).publicKey) });
  const r = await api('POST', `/api/schedules/${item.shareId}`, { keys });
  if (r.ok) { item.publishedThrough = now + PUBLISHED_AHEAD; stats.publishes++; }
}

async function refreshItemLabel(item, flash) {
  const now = epochAt();
  const k = await keyFor(item, now);
  const changed = item.hash && item.hash !== k.keyHash;
  item.hash = k.keyHash;
  if (changed) stats.rotations++;
  const left = EPOCH_SECONDS - Math.floor(Date.now() / 1000) % EPOCH_SECONDS;
  label(item.el, `key ${k.keyHash.slice(0, 8)} · rotates in ${left}s`, flash || changed);
  if (item.publishedThrough - now < 5) publish(item);
}

// ---------- finders ----------

function newFinder(n) {
  const spam = n === SPAMMY;
  const f = {
    n, spam,
    id: B64URL.encode(crypto.getRandomValues(new Uint8Array(16))),
    x: 10 + Math.random() * 80, y: 10 + Math.random() * 80,
    vx: 0, vy: 0, steerAt: 0, last: new Map(), el: null, inFlight: 0,
  };
  f.el = sprite(`finder${spam ? ' spam' : ''}`, spam ? '📱' : '📱', f.x, f.y);
  label(f.el, spam ? `finder ${n} · spammy, 20/s` : `finder ${n}`);
  return f;
}

function steer(f, now) {
  if (now < f.steerAt) return;
  const speed = 5 + Math.random() * 5; // percent per second
  const a = Math.random() * Math.PI * 2;
  f.vx = Math.cos(a) * speed; f.vy = Math.sin(a) * speed;
  f.steerAt = now + 800 + Math.random() * 2200;
}

function move(f, dt, now) {
  steer(f, now);
  f.x += f.vx * dt; f.y += f.vy * dt;
  if (f.x < 4) { f.x = 4; f.vx = Math.abs(f.vx); } if (f.x > 96) { f.x = 96; f.vx = -Math.abs(f.vx); }
  if (f.y < 6) { f.y = 6; f.vy = Math.abs(f.vy); } if (f.y > 94) { f.y = 94; f.vy = -Math.abs(f.vy); }
  place(f.el, f.x, f.y);
}

function near(a, b) { const dx = a.x - b.x, dy = (a.y - b.y) * 0.625; return Math.hypot(dx, dy) < RANGE; }

async function report(f, item) {
  if (f.inFlight > (f.spam ? 8 : 1)) return;
  f.inFlight++;
  try {
    const k = await keyFor(item, epochAt());
    const plaintext = { item: item.emoji, x: +item.x.toFixed(1), y: +item.y.toFixed(1), finder: f.n, at: new Date().toISOString() };
    const envelope = await encryptReport(k.publicKey, plaintext);
    const ct = hex(envelope);
    const p = packet(f, serverPos, `🔒 ${ct.slice(0, 12)}…`, '');
    const r = await api('POST', '/api/reports', { keyHash: k.keyHash, ciphertext: B64URL.encode(envelope) }, { 'X-Beacon-Finder': f.id, 'X-Beacon-Finder-Name': `finder ${f.n}${f.spam ? ' spammy' : ''}` });
    if (r.status === 201) stats.reports201++; else if (r.status === 429) stats.reports429++;
    if (p) {
      const verdict = r.status === 201 ? `201 stored ${envelope.length} B` : r.status === 429 ? `429 retry after ${r.headers.get('Retry-After')} s` : `${r.status}`;
      setTimeout(() => { p.textContent = verdict; p.classList.add(r.status === 201 ? 'ok' : 'rejected'); }, 700);
    }
  } finally { f.inFlight--; }
}

function maybeReport(f, now) {
  for (const item of items) {
    if (!near(f, item)) continue;
    const last = f.last.get(item) || 0;
    if (now - last < (f.spam ? SPAM_EVERY_MS : REPORT_EVERY_MS)) continue;
    f.last.set(item, now);
    report(f, item);
  }
}

// ---------- owner ----------

const ownerEl = sprite('owner', '🏠', ownerPos.x, ownerPos.y);
label(ownerEl, 'owner · decrypts here');
const decrypted = new Set();

async function ownerPoll() {
  if (!items.length) return;
  const now = epochAt();
  const byHash = new Map();
  for (const item of items) for (let e = now - LOOKBACK_EPOCHS + 1; e <= now; e++) {
    const k = await keyFor(item, e); byHash.set(k.keyHash, { item, k });
  }
  const r = await api('GET', `/api/reports?${[...byHash.keys()].map(h => `h=${h}`).join('&')}`);
  if (!r.ok) return;
  let fresh = 0;
  for (const [hash, reports] of Object.entries(r.json)) {
    const { item, k } = byHash.get(hash);
    for (const rep of reports) {
      const id = `${rep.ts}:${hash}`;
      if (decrypted.has(id)) continue;
      decrypted.add(id);
      try {
        const s = await decryptReport(k.privateKey, B64URL.decode(rep.ciphertext));
        const cur = seen.get(item);
        if (!cur || Date.parse(rep.ts) > cur.ts) showSeen(item, { x: s.x, y: s.y, finder: s.finder, ts: Date.parse(rep.ts) });
        fresh++; stats.sightings++;
      } catch (e) { console.warn('undecryptable', e); }
    }
  }
  if (fresh) packet(serverPos, ownerPos, `🔓 ${fresh} decrypted here`, 'back');
}

function showSeen(item, s) {
  let cur = seen.get(item);
  if (!cur) { cur = { el: sprite('seen', '📍', s.x, s.y) }; seen.set(item, cur); }
  Object.assign(cur, s);
  place(cur.el, s.x + 3, s.y - 3);
  refreshSeenLabel(item, cur);
}

function refreshSeenLabel(item, cur) {
  label(cur.el, `${item.emoji} seen ${Math.max(0, Math.round((Date.now() - cur.ts) / 1000))}s ago by finder ${cur.finder}`);
}

// ---------- header, log panel, chaos ----------

async function showHealth() {
  try {
    const r = await api('GET', '/health');
    const served = r.headers.get('X-Beacon-Replica') || r.json?.replica || '?';
    leader = r.json?.leader ?? '?';
    $('replica').textContent = `served by ${served} · leader ${leader}`;
  } catch { $('replica').textContent = 'server unreachable'; }
}

function openLog(replica) {
  const es = new EventSource(`/api/log?replica=${replica}`);
  es.addEventListener('log', ev => appendLog(ev.data));
  es.onerror = () => appendLog(`${replica} (stream down, reconnecting)`);
  return es;
}

const logEl = $('log');
let logLines = 0;
function appendLog(line) {
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  const span = document.createElement('span');
  const cls = [line[0] === 'A' ? 'A' : line[0] === 'B' ? 'B' : ''];
  if (line.includes('[RateLimit]')) cls.push('rl');
  if (line.includes('[Leader]') || line.includes('[Chaos]') || line.includes('[Boot]')) cls.push('ld');
  if (line.includes('[Sweep]')) cls.push('sw');
  span.className = cls.join(' ');
  span.textContent = line + '\n';
  logEl.appendChild(span);
  if (++logLines > 300) { logEl.firstChild.remove(); logLines--; }
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

async function killLeader() {
  const btn = $('kill');
  btn.disabled = true;
  const who = leader;
  appendLog(`— you pressed kill the leader (${who}); watch [Chaos] and [Leader] below`);
  const r = await api('POST', `/api/chaos/kill-leader?replica=${who}`);
  if (!r.ok) appendLog(`— kill refused: ${r.status} ${r.json?.error || ''}`);
  setTimeout(() => { btn.disabled = false; }, 30000);
}

// ---------- main loop ----------

function updateCounts() {
  $('counts').textContent = `${stats.reports201} reports stored · ${stats.reports429} rejected with 429 · ${stats.rotations} key rotations seen · ${stats.sightings} sightings decrypted here · ${items.length} items`;
}

let lastFrame = performance.now();
let lastEpoch = epochAt();
let lastSecond = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  for (const f of finders) { move(f, dt, now); maybeReport(f, now); }
  const sec = Math.floor(Date.now() / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec;
    const epoch = epochAt();
    const rotated = epoch !== lastEpoch;
    lastEpoch = epoch;
    for (const item of items) refreshItemLabel(item, rotated);
    for (const [item, cur] of seen) refreshSeenLabel(item, cur);
    updateCounts();
  }
  requestAnimationFrame(frame);
}

async function main() {
  const h = await api('GET', '/health');
  if (h.ok && h.json.epochSeconds) EPOCH_SECONDS = h.json.epochSeconds;
  $('epoch-len').textContent = EPOCH_SECONDS;
  lastEpoch = epochAt();
  await showHealth();
  setInterval(showHealth, 3000);
  openLog('A'); openLog('B');
  $('kill').onclick = killLeader;
  field.onclick = ev => {
    const r = field.getBoundingClientRect();
    addItem(((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100);
  };
  await addItem(25 + Math.random() * 20, 25 + Math.random() * 30);
  await addItem(50 + Math.random() * 20, 55 + Math.random() * 25);
  await addItem(65 + Math.random() * 15, 25 + Math.random() * 20);
  for (let n = 0; n < FINDER_COUNT; n++) finders.push(newFinder(n));
  requestAnimationFrame(frame);
  setInterval(ownerPoll, OWNER_POLL_MS);
  setTimeout(ownerPoll, 1500);
}

main().catch(e => { $('replica').textContent = `this browser could not run the crypto: ${e}`; console.error(e); });
