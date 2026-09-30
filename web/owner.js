// Owner page: mint a share id once per browser, register it, show the finder link and QR.

const SHARE_KEY = 'beacon.shareId';

function mintShareId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return B64URL.encode(bytes);
}

async function main() {
  let shareId = localStorage.getItem(SHARE_KEY);
  if (!shareId) {
    shareId = mintShareId();
    localStorage.setItem(SHARE_KEY, shareId);
  }
  $('share-id').textContent = shareId;

  const link = `${location.origin}/f/${shareId}`;
  $('finder-link').value = link;
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });

  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); setStatus('share-status', 'copied'); }
    catch { $('finder-link').select(); setStatus('share-status', 'select and copy the link above'); }
  };

  const r = await api('POST', `/api/shares/${shareId}`);
  setStatus('share-status', r.ok ? `registered with the server (${r.json.created})` : `register failed: ${r.status}`, !r.ok);

  showReplica();
  setInterval(showReplica, 5000);
}

main();
