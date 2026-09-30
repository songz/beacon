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

async function api(method, path, body, headers = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: res.ok, status: res.status, headers: res.headers, json, text };
}

function $(id) { return document.getElementById(id); }
