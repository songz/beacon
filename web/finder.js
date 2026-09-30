// Finder page. Fetch the item's public key for this epoch, take a coarse location, encrypt it here, post it.

let item;

async function locate() {
  const ip = await api('GET', '/api/whereami');
  const base = ip.ok ? ip.json : { city: 'somewhere', source: 'ip' };
  if (!navigator.geolocation) return base;
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ ...base, lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2), source: 'browser' }),
      () => resolve(base),
      { timeout: 5000, maximumAge: 600000 });
  });
}

async function report() {
  $('report').disabled = true;
  setStatus('finder-status', 'locating');
  try {
    const where = await locate();
    const plaintext = { ...where, at: new Date().toISOString() };
    setStatus('finder-status', `encrypting "${where.city}" to epoch key ${item.epoch}`);
    const envelope = await encryptReport(B64URL.decode(item.publicKey), plaintext);
    const keyHash = B64URL.encode(await crypto.subtle.digest('SHA-256', B64URL.decode(item.publicKey)));
    const r = await api('POST', '/api/reports', { keyHash, ciphertext: B64URL.encode(envelope) });
    if (r.ok) {
      setStatus('finder-status', `reported, encrypted, the server can't read it. It stored ${r.json.bytes} bytes under key hash ${keyHash.slice(0, 8)}.`);
      $('plaintext').textContent = JSON.stringify(plaintext);
      $('ciphertext').textContent = hex(envelope);
      $('proof').open = true;
    } else if (r.status === 429) {
      setStatus('finder-status', `slow down: rate limited, retry after ${r.headers.get('Retry-After')} s`, true);
    } else {
      setStatus('finder-status', `report failed: ${r.status} ${r.text}`, true);
    }
  } catch (e) {
    setStatus('finder-status', `could not report: ${e}`, true);
  } finally {
    $('report').disabled = false;
  }
}

async function main() {
  const shareId = location.pathname.split('/').pop();
  $('share-id').textContent = shareId;
  const r = await api('GET', `/api/schedules/${shareId}/current`);
  if (!r.ok) {
    setStatus('finder-status', r.status === 404 ? 'no item has this share id, or its owner has not published keys for today' : `error ${r.status}`, true);
    return;
  }
  item = r.json;
  $('epoch').textContent = item.epoch;
  $('pubkey').textContent = hex(B64URL.decode(item.publicKey));
  setStatus('finder-status', 'ready. Your location is encrypted in this tab before anything is sent.');
  $('report').disabled = false;
  $('report').onclick = report;
  showReplica();
  setInterval(showReplica, 5000);
}

main().catch(e => setStatus('finder-status', `this browser could not run the crypto: ${e}`, true));
