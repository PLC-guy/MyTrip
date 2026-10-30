/**
 * CIFRATURA DEI VIAGGI CONDIVISI (sync.ts)
 *
 * Tutto ciò che va sul server si cifra qui, sul telefono, con AES-GCM a 256 bit
 * (Web Crypto, integrato nel browser). La chiave nasce sul telefono di chi
 * viaggia e viaggia solo dentro il link dato a chi segue, dopo il «#»: il
 * server non la vede mai, quindi conserva soltanto dati illeggibili.
 *
 * Ogni pezzo cifrato è «iv (12 byte) + dati». Il nome del pezzo (es.
 * «<id>/p/<foto>») entra nella cifratura come dato aggiuntivo: un pezzo
 * spostato sotto un altro nome non si decifra.
 */

export function toB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomB64url(bytes: number): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

const keys = new Map<string, Promise<CryptoKey>>()

function cryptoKey(raw: string): Promise<CryptoKey> {
  let k = keys.get(raw)
  if (!k) {
    k = crypto.subtle.importKey('raw', fromB64url(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
    keys.set(raw, k)
  }
  return k
}

export async function encrypt(rawKey: string, data: BufferSource, name: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name) }, await cryptoKey(rawKey), data))
  const all = new Uint8Array(12 + out.length)
  all.set(iv)
  all.set(out, 12)
  return all
}

export async function decrypt(rawKey: string, data: ArrayBuffer, name: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(name) }, await cryptoKey(rawKey), bytes.slice(12))
}

export async function sha256(text: string): Promise<string> {
  return toB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}
