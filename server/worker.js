/**
 * SERVER DEI VIAGGI CONDIVISI IN DIRETTA (Cloudflare Worker + Workers KV)
 *
 * Serve solo ai viaggi che l'utente decide di condividere: chi viaggia carica le
 * novità, chi segue le scarica. ⚠️ Il server non può leggere niente: l'app cifra
 * tutto prima di caricarlo (AES-GCM, `src/crypt.ts`) e la chiave sta solo nel
 * link dato a chi segue, dopo il «#», che non arriva mai qui.
 *
 * Per ogni viaggio condiviso (id casuale di 22 caratteri):
 *   <id>/m        indice cifrato: viaggio, tappe, percorsi, elenco delle foto
 *   <id>/p/<foto> miniatura cifrata, una per foto
 *   <id>/subs     telefoni che seguono con le notifiche attive (vedi sotto)
 *   a/<id>        impronta (SHA-256) del permesso di scrittura
 *   subs-index    viaggi con almeno un'iscrizione alle notifiche
 *
 * Leggere: chiunque conosca l'id (inutile senza la chiave). Scrivere e
 * cancellare: solo con il permesso di scrittura, che resta sul telefono di chi
 * viaggia. Il primo caricamento registra l'impronta del permesso.
 *
 * NOTIFICHE (Web Push, idea dell'utente del 30/10/2026): chi segue sceglie «a
 * ogni novità» o «una al giorno» all'ora che vuole. Chi viaggia, dopo aver
 * caricato foto nuove, manda qui un messaggio GIÀ CIFRATO con la chiave del
 * viaggio (`POST <id>/n`); il server lo mette in coda per ogni iscritto e lo
 * inoltra subito o nel riepilogo. Lo decifra il telefono che lo riceve
 * (`public/push-sw.js`). Chiave privata VAPID: segreto `VAPID_JWK` del Worker.
 *
 * ⚠️ Piano gratuito di Workers KV: 1000 scritture e 1000 cancellazioni al giorno,
 * 100.000 letture, 1 GB. Oltre, il servizio risponde con un errore fino al giorno
 * dopo: l'app riprova da sola.
 */

const ORIGINS = ['https://plc-guy.github.io', 'http://localhost:5180', 'http://localhost:4180']
const MAX_INDEX = 8 * 1024 * 1024
const MAX_PHOTO = 2 * 1024 * 1024
const ID = '([A-Za-z0-9_-]{22})'
/** «A ogni novità»: almeno questo intervallo fra due notifiche; le novità nel mezzo partono insieme. */
const GAP_MS = 15 * 60_000
/** Messaggi tenuti in coda per iscritto: bastano per un riepilogo, stanno in una notifica. */
const QUEUE_MAX = 12
const VAPID_SUBJECT = 'https://plc-guy.github.io/MyTrip/'

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin')
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Version',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
    const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...cors, 'Cache-Control': 'no-store', ...extra } })
    if (req.method === 'OPTIONS') return reply(null, 204)

    const path = new URL(req.url).pathname
    try {
      let m
      if ((m = new RegExp(`^/s/${ID}/sub$`).exec(path)) && req.method === 'POST') return reply(await subscribe(env, m[1], await req.json()))
      if ((m = new RegExp(`^/s/${ID}/sub/([A-Za-z0-9_-]{43})$`).exec(path)) && req.method === 'DELETE') return reply(await unsubscribe(env, m[1], m[2]))
      if ((m = new RegExp(`^/s/${ID}/n$`).exec(path)) && req.method === 'POST') {
        if (!(await checkAuth(env, m[1], req.headers.get('Authorization'), false))) return reply('non autorizzato', 403)
        const { c } = await req.json()
        if (typeof c !== 'string' || c.length > 600) return reply('messaggio non valido', 400)
        return reply(await notify(env, m[1], c))
      }

      const match = new RegExp(`^/s/${ID}(?:/(m|v|p/([A-Za-z0-9-]{1,64})))?$`).exec(path)
      if (!match) return reply('non trovato', 404)
      const [, id, part, photo] = match
      const key = part === 'v' ? `${id}/m` : part ? `${id}/${part}` : undefined

      if (req.method === 'GET') {
        if (!key) return reply('non trovato', 404)
        if (part === 'v') {
          // Solo la versione dell'indice: chi segue la chiede spesso, l'indice intero solo se è cambiato.
          const { value, metadata } = await env.KV.getWithMetadata(key, 'stream')
          await value?.cancel()
          return value ? reply(metadata?.v ?? '0', 200, { 'Content-Type': 'text/plain' }) : reply('non trovato', 404)
        }
        const value = await env.KV.get(key, 'arrayBuffer')
        return value ? reply(value, 200, { 'Content-Type': 'application/octet-stream' }) : reply('non trovato', 404)
      }

      if (req.method !== 'PUT' && req.method !== 'DELETE') return reply('metodo non ammesso', 405)
      const auth = await checkAuth(env, id, req.headers.get('Authorization'), req.method === 'PUT')
      if (!auth) return reply('non autorizzato', 403)

      if (req.method === 'PUT') {
        if (!key || part === 'v') return reply('non trovato', 404)
        const body = await req.arrayBuffer()
        if (body.byteLength > (photo ? MAX_PHOTO : MAX_INDEX)) return reply('troppo grande', 413)
        const version = req.headers.get('X-Version') ?? String(Date.now())
        await env.KV.put(key, body, part === 'm' ? { metadata: { v: version } } : undefined)
        return reply('ok')
      }

      // DELETE di una foto, oppure dell'intero viaggio condiviso (iscrizioni comprese).
      if (key) {
        await env.KV.delete(key)
        return reply('ok')
      }
      let cursor
      do {
        const page = await env.KV.list({ prefix: `${id}/`, cursor })
        await Promise.all(page.keys.map((k) => env.KV.delete(k.name)))
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      await env.KV.delete(`a/${id}`)
      return reply('ok')
    } catch (e) {
      return reply(`errore: ${e instanceof Error ? e.message : String(e)}`, 500)
    }
  },

  /** Ogni 15 minuti: riepiloghi giornalieri all'ora scelta e novità rimaste in attesa. */
  async scheduled(_event, env) {
    const ids = (await env.KV.get('subs-index', 'json')) ?? []
    const left = []
    for (const id of ids) {
      const subs = await env.KV.get(`${id}/subs`, 'json')
      if (!subs || Object.keys(subs).length === 0) continue
      left.push(id)
      if (await flush(env, id, subs, false)) await env.KV.put(`${id}/subs`, JSON.stringify(subs))
    }
    if (left.length !== ids.length) await env.KV.put('subs-index', JSON.stringify(left))
  },
}

// --- Notifiche ---------------------------------------------------------------

async function subscribe(env, id, body) {
  const { h, endpoint, keys, mode, hour, tz } = body ?? {}
  if (typeof h !== 'string' || !/^https:\/\//.test(endpoint ?? '') || !keys?.p256dh || !keys?.auth) throw new Error('iscrizione non valida')
  if (mode !== 'each' && mode !== 'daily') throw new Error('modalità non valida')
  // Solo viaggi che esistono: niente iscrizioni a id inventati.
  if (!(await env.KV.get(`a/${id}`))) throw new Error('viaggio non condiviso')
  const subs = (await env.KV.get(`${id}/subs`, 'json')) ?? {}
  const old = subs[h]
  subs[h] = { endpoint, keys, mode, hour: Math.min(23, Math.max(0, Number(hour) || 20)), tz: String(tz || 'Europe/Rome'), last: old?.last, day: old?.day, queue: old?.queue ?? [] }
  await env.KV.put(`${id}/subs`, JSON.stringify(subs))
  const index = (await env.KV.get('subs-index', 'json')) ?? []
  if (!index.includes(id)) await env.KV.put('subs-index', JSON.stringify([...index, id]))
  return 'ok'
}

async function unsubscribe(env, id, h) {
  const subs = await env.KV.get(`${id}/subs`, 'json')
  if (subs?.[h]) {
    delete subs[h]
    await env.KV.put(`${id}/subs`, JSON.stringify(subs))
  }
  return 'ok'
}

/** Novità da chi viaggia: in coda per ogni iscritto; «a ogni novità» parte subito se è passato GAP_MS. */
async function notify(env, id, c) {
  const subs = await env.KV.get(`${id}/subs`, 'json')
  if (!subs || Object.keys(subs).length === 0) return 'nessuno'
  for (const s of Object.values(subs)) s.queue = [...(s.queue ?? []), c].slice(-QUEUE_MAX)
  await flush(env, id, subs, true)
  await env.KV.put(`${id}/subs`, JSON.stringify(subs))
  return 'ok'
}

/** Invia ciò che è dovuto. Restituisce true se qualcosa è cambiato (da salvare). */
async function flush(env, id, subs, fromNotify) {
  const now = Date.now()
  let changed = false
  for (const [h, s] of Object.entries(subs)) {
    if (!s.queue?.length) continue
    let daily = false
    if (s.mode === 'each') {
      if (s.last && now - s.last < GAP_MS) continue
    } else {
      // Riepilogo: nel primo giro della sua ora, una volta al giorno, nel fuso di chi segue.
      if (fromNotify) continue
      const { hour, day } = localTime(now, s.tz)
      if (hour !== s.hour || s.day === day) continue
      s.day = day
      daily = true
    }
    const status = await sendPush(env, s, JSON.stringify({ s: id, d: daily ? 1 : 0, m: s.queue }))
    changed = true
    if (status === 404 || status === 410) {
      // Iscrizione scaduta o notifiche disattivate sul telefono.
      delete subs[h]
      continue
    }
    s.queue = []
    s.last = now
  }
  return changed
}

function localTime(ms, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms))
    const get = (t) => parts.find((p) => p.type === t)?.value
    return { hour: Number(get('hour')), day: `${get('year')}-${get('month')}-${get('day')}` }
  } catch {
    return localTime(ms, 'Europe/Rome')
  }
}

// --- Web Push (RFC 8291 per il contenuto, RFC 8292 per VAPID) -----------------

const enc = (s) => new TextEncoder().encode(s)
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** Contenuto cifrato per quel telefono (aes128gcm): solo lui può leggerlo. */
async function encryptFor(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh)
  const auth = unb64u(sub.keys.auth)
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))
  const ikm = await hkdf(auth, shared, concat(enc('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc(payload), new Uint8Array([2]))))
  const header = new Uint8Array(21)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, body)
}

let vapid
async function vapidKeys(env) {
  if (!vapid) {
    const jwk = JSON.parse(env.VAPID_JWK)
    vapid = {
      key: await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
      pub: b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y))),
    }
  }
  return vapid
}

async function sendPush(env, sub, payload) {
  const { key, pub } = await vapidKeys(env)
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(enc(JSON.stringify({ aud: new URL(sub.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${head}.${claims}`)))
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 3600),
        Urgency: 'normal',
      },
      body: await encryptFor(sub, payload),
    })
    return r.status
  } catch {
    return 0
  }
}

/** Il permesso di scrittura si confronta con la sua impronta: il server non conserva il permesso. */
async function checkAuth(env, id, header, mayCreate) {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  if (token.length < 32) return false
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  const hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
  const stored = await env.KV.get(`a/${id}`)
  if (stored) return stored === hash
  if (!mayCreate) return false
  await env.KV.put(`a/${id}`, hash)
  return true
}
