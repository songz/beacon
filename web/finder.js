// Finder page: the share id comes from the URL. Reporting arrives in the next commit.

async function main() {
  const shareId = location.pathname.split('/').pop();
  $('share-id').textContent = shareId;
  const r = await api('GET', `/api/shares/${shareId}`);
  if (r.ok) {
    setStatus('finder-status', `this item was registered ${r.json.created}. Reporting a sighting comes next.`);
  } else {
    setStatus('finder-status', r.status === 404 ? 'no item has this share id' : `error ${r.status}`, true);
  }
  showReplica();
  setInterval(showReplica, 5000);
}

main();
