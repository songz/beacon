// Owner page. The seed never leaves localStorage. Everything the server gets is derived: the share id, and
// one public key per 15-minute epoch. Sightings come back as ciphertext and are decrypted here.

const SEED_KEY = 'beacon.seed';
const POLL_MS = 5000;

const seen = new Map(); // ts + hash -> decrypted sighting, so the list is stable across polls
let seed, shareId;

function loadSeed() {
  const stored = localStorage.getItem(SEED_KEY);
  if (stored) return B64URL.decode(stored);
  const fresh = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SEED_KEY, B64URL.encode(fresh));
  return fresh;
}

async function publishSchedule() {
  const now = epochAt();
  const keys = [];
  for (let e = now; e <= now + PUBLISHED_AHEAD; e++) {
    const k = await epochKey(seed, e);
    keys.push({ epoch: e, publicKey: B64URL.encode(k.publicKey) });
  }
  const r = await api('POST', `/api/schedules/${shareId}`, { keys });
  setStatus('share-status', r.ok
    ? `published ${r.json.stored} public keys (epochs ${now} to ${now + PUBLISHED_AHEAD}, 24 hours). The seed stayed here.`
    : `publish failed: ${r.status} ${r.text}`, !r.ok);
}

async function poll() {
  const now = epochAt();
  const keys = [];
  for (let e = now - PUBLISHED_AHEAD; e <= now; e++) keys.push(await epochKey(seed, e));
  const byHash = new Map(keys.map(k => [k.keyHash, k]));
  const query = keys.map(k => `h=${k.keyHash}`).join('&');
  const r = await api('GET', `/api/reports?${query}`);
  if (!r.ok) { setStatus('poll-status', `fetch failed: ${r.status}`, true); return; }
  let fresh = 0;
  for (const [hash, reports] of Object.entries(r.json)) {
    const key = byHash.get(hash);
    for (const rep of reports) {
      const id = `${rep.ts}:${hash}`;
      if (seen.has(id)) continue;
      try {
        const envelope = B64URL.decode(rep.ciphertext);
        const sighting = await decryptReport(key.privateKey, envelope);
        seen.set(id, { ts: rep.ts, epoch: key.epoch, sighting, bytes: envelope.length });
        fresh++;
      } catch (e) {
        seen.set(id, { ts: rep.ts, epoch: key.epoch, error: String(e) });
      }
    }
  }
  render();
  setStatus('poll-status', `checked ${keys.length} key hashes, ${seen.size} sightings decrypted here, ${new Date().toLocaleTimeString()}`);
}

function relative(ts) {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function render() {
  const list = $('sightings');
  const items = [...seen.values()].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  if (!items.length) { list.innerHTML = '<li class="status">nothing yet. Open the finder link in another tab or phone.</li>'; return; }
  list.innerHTML = items.map(it => {
    if (it.error) return `<li><span class="pill">undecryptable</span> ${it.error}</li>`;
    const s = it.sighting;
    const place = [s.city, s.region].filter(Boolean).join(', ') || 'somewhere';
    const map = (s.lat != null && s.lon != null)
      ? ` <a href="https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=12/${s.lat}/${s.lon}" target="_blank" rel="noopener">map</a>` : '';
    return `<li><strong>seen in ${place}</strong> ${relative(it.ts)}${map}<br>
      <span class="status">via ${s.source === 'browser' ? 'browser geolocation' : 'finder IP'} · epoch key ${it.epoch} · ${it.bytes} bytes of ciphertext on the server</span></li>`;
  }).join('');
}

async function main() {
  seed = loadSeed();
  shareId = await shareIdFromSeed(seed);
  $('share-id').textContent = shareId;

  const link = `${location.origin}/f/${shareId}`;
  $('finder-link').value = link;
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });

  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); setStatus('copy-status', 'copied'); }
    catch { $('finder-link').select(); setStatus('copy-status', 'select and copy the link above'); }
  };
  $('forget').onclick = () => {
    if (!confirm('Forget this item? The seed is deleted from this browser and its sightings can never be decrypted again.')) return;
    localStorage.removeItem(SEED_KEY);
    location.reload();
  };

  await publishSchedule();
  setInterval(publishSchedule, EPOCH_SECONDS * 1000);
  await poll();
  setInterval(poll, POLL_MS);

  showReplica();
  setInterval(showReplica, 5000);
  showStats();
  setInterval(showStats, 10000);
}

async function showStats() {
  const r = await api('GET', '/api/stats');
  if (!r.ok) return;
  const rows = (r.json.rows || []).sort((a, b) => b.epoch - a.epoch);
  $('stats').innerHTML = rows.length
    ? rows.map(s => `<li>epoch ${s.epoch}: <strong>${s.reports}</strong> report${s.reports === 1 ? '' : 's'} <span class="status">counted by replica ${s.sweptBy} at ${new Date(s.sweptAt).toLocaleTimeString()}</span></li>`).join('')
    : `<li class="status">no sweep yet (leader is ${r.json.leader}; the sweep runs every 30 s and counts only epochs with reports)</li>`;
}

main().catch(e => setStatus('share-status', `this browser could not run the crypto: ${e}`, true));
