// The whole protocol, in the browser, with WebCrypto only.
//
//   seed (32 random bytes, owner's browser only)
//     └─ HKDF-SHA256(seed, "beacon-share-id")        → share id (public name for the item)
//     └─ HKDF-SHA256(seed, "beacon-epoch-" + epoch)   → P-256 private scalar for that 15-minute epoch
//                                                        → public key, published; SHA-256(public key) indexes reports
//   finder: ephemeral P-256 key, ECDH with the epoch public key, HKDF → AES-256-GCM key, encrypt the location
//   owner:  same ECDH from the other side with the epoch private key, decrypt
//
// This is the shape of Apple's Find My offline finding: rotating keys derived from one secret, ECDH with an
// ephemeral key per report, and a server that only ever sees public keys and ciphertext.

let EPOCH_SECONDS = 60;        // the server's /health says what it runs; the demo uses 60 s, real Find My 15 min
const PUBLISHED_AHEAD = 30;    // epochs published in advance per item (30 minutes in the demo)

const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');

// PKCS#8 wrapper for a P-256 private key that carries only the scalar (no public point). WebCrypto computes
// the public point for us on import, which is the one thing it will not do from a raw scalar directly.
const PKCS8_P256_PREFIX = Uint8Array.from([
  0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
  0x01, 0x04, 0x20,
]);

function epochAt(ms = Date.now()) {
  return Math.floor(ms / 1000 / EPOCH_SECONDS);
}

async function hkdf(ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    key, bytes * 8));
}

async function shareIdFromSeed(seed) {
  return B64URL.encode(await hkdf(seed, 'beacon-share-id', 16));
}

function bytesToBigInt(bytes) {
  return BigInt('0x' + hex(bytes));
}

// One key pair per epoch. Returns the private key (for ECDH), the raw 65-byte public point, and its hash.
async function epochKey(seed, epoch) {
  let scalar;
  for (let attempt = 0; ; attempt++) {
    scalar = await hkdf(seed, `beacon-epoch-${epoch}` + (attempt ? `-${attempt}` : ''), 32);
    const d = bytesToBigInt(scalar);
    if (d > 0n && d < P256_ORDER) break; // out of range about once in 2^128 tries; loop anyway, like the spec says
  }
  const pkcs8 = new Uint8Array(PKCS8_P256_PREFIX.length + 32);
  pkcs8.set(PKCS8_P256_PREFIX);
  pkcs8.set(scalar, PKCS8_P256_PREFIX.length);
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(B64URL.decode(jwk.x), 1);
  publicKey.set(B64URL.decode(jwk.y), 33);
  const keyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey));
  return { epoch, privateKey, publicKey, keyHash: B64URL.encode(keyHash) };
}

async function importPublicPoint(raw65) {
  return crypto.subtle.importKey('raw', raw65, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function aesKeyFromSharedSecret(sharedBits) {
  const keyBytes = await hkdf(new Uint8Array(sharedBits), 'beacon-report', 32);
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Finder side. Envelope = ephemeral public point (65) || nonce (12) || AES-GCM ciphertext and tag.
async function encryptReport(itemPublicKeyRaw, plaintextObject) {
  const itemPublicKey = await importPublicPoint(itemPublicKeyRaw);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: itemPublicKey }, ephemeral.privateKey, 256);
  const aes = await aesKeyFromSharedSecret(shared);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(plaintextObject));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plaintext));
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const envelope = new Uint8Array(65 + 12 + ct.length);
  envelope.set(ephemeralRaw, 0);
  envelope.set(nonce, 65);
  envelope.set(ct, 77);
  return envelope;
}

// Owner side.
async function decryptReport(epochPrivateKey, envelope) {
  const ephemeralPublic = await importPublicPoint(envelope.slice(0, 65));
  const nonce = envelope.slice(65, 77);
  const ct = envelope.slice(77);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephemeralPublic }, epochPrivateKey, 256);
  const aes = await aesKeyFromSharedSecret(shared);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ct);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
