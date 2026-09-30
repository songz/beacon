// Helpers shared by the owner page and the finder page. No framework: the whole client is three files.

const B64URL = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  },
  decode(str) {
    const b64 = str.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - str.length % 4) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: res.ok, status: res.status, headers: res.headers, json, text };
}

// Header line: which replica answered this request. Refreshed every few seconds so a failover is visible.
async function showReplica() {
  const el = document.getElementById('replica');
  if (!el) return;
  try {
    const r = await api('GET', '/health');
    const served = r.headers.get('X-Beacon-Replica') || r.json?.replica || '?';
    el.textContent = `served by replica ${served}`;
  } catch {
    el.textContent = 'server unreachable';
  }
}

function $(id) { return document.getElementById(id); }

function setStatus(id, text, isError) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', !!isError);
}
