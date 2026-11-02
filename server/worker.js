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
 *
 * SICUREZZA (revisione del 1/11/2026):
 * - S9: «Smetti di condividere» non libera l'id: `a/<id>` diventa REVOKED per
 *   sempre, così chi aveva il vecchio link non può riprenderselo e mandare un
 *   viaggio falso (o vuoto) a chi seguiva.
 * - S3: limite di richieste per indirizzo IP (binding `RL`, Rate Limiting dei
 *   Workers). ⚠️ È un filtro largo, non una difesa completa: con le 1000
 *   scritture al giorno di KV, chi vuole può comunque esaurirle in poco tempo.
 *   La difesa vera è un magazzino con quote più alte (da valutare con i viaggi
 *   insieme).
 * - S4: iscrizioni alle notifiche controllate (al massimo SUBS_MAX per viaggio,
 *   solo servizi push veri, campi di lunghezza fissa) e coda tenuta se l'invio
 *   non riesce per un problema momentaneo.
 *
 * CONTEGGIO E PAGINA DI STATO (richiesta dell'utente, 2/11/2026, fase di prova):
 * - `POST /ping`: ogni app manda una volta al giorno un codice casuale, la
 *   versione, se è installata e il sistema (`src/ping.ts`). Niente dati dei
 *   viaggi. Si contano i codici diversi.
 * - Conteggi e date delle condivisioni stanno in un Durable Object
 *   (`Contatore`, archivio SQLite): non consumano le scritture di KV.
 * - `GET /stato`: pagina per l'utente, protetta dal segreto `ADMIN_KEY` del
 *   Worker. La chiave va dopo il «#» del link (non arriva al server) e la
 *   pagina la manda in un'intestazione a `GET /stato/dati`. Senza il segreto
 *   impostato la pagina non esiste.
 */

import { DurableObject } from 'cloudflare:workers'

const ORIGINS = ['https://plc-guy.github.io', 'http://localhost:5180', 'http://localhost:4180']
const MAX_INDEX = 8 * 1024 * 1024
const MAX_PHOTO = 2 * 1024 * 1024
const ID = '([A-Za-z0-9_-]{22})'
/** «A ogni novità»: almeno questo intervallo fra due notifiche; le novità nel mezzo partono insieme. */
const GAP_MS = 15 * 60_000
/** Messaggi tenuti in coda per iscritto: bastano per un riepilogo, stanno in una notifica. */
const QUEUE_MAX = 12
const VAPID_SUBJECT = 'https://plc-guy.github.io/MyTrip/'
/** Segno al posto dell'impronta del permesso: viaggio condiviso e poi revocato. */
const REVOKED = 'revocato'
/** Telefoni che possono seguire un viaggio con le notifiche attive. */
const SUBS_MAX = 20
/** Servizi push veri (Apple, Google, Mozilla, Microsoft): solo verso questi si mandano notifiche. */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]

/** Errore con il suo codice HTTP, da mostrare senza dettagli interni. */
class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Limite per indirizzo IP (filtro largo: vedi in cima). Senza il binding `RL`
 * (per esempio in locale) non limita niente.
 */
async function tooMany(env, req, what) {
  if (!env.RL) return false
  const ip = req.headers.get('CF-Connecting-IP') ?? 'sconosciuto'
  const { success } = await env.RL.limit({ key: `${what}:${ip}` })
  return !success
}

export default {
  async fetch(req, env, ctx) {
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
      if (req.method !== 'GET' && (await tooMany(env, req, 'w'))) return reply('troppe richieste', 429)
      if (path === '/ping' && req.method === 'POST') {
        const t = await req.json().catch(() => null)
        if (!validPing(t)) return reply('non valido', 400)
        await counter(env).ping(t)
        return reply('ok')
      }
      if (path === '/stato' && req.method === 'GET') return env.ADMIN_KEY ? new Response(STATO_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }) : reply('non trovato', 404)
      if (path === '/stato/dati' && req.method === 'GET') {
        if (!env.ADMIN_KEY || !(await sameSecret(req.headers.get('Authorization') ?? '', `Bearer ${env.ADMIN_KEY}`))) return reply('non autorizzato', 403)
        return reply(JSON.stringify(await statusReport(env)), 200, { 'Content-Type': 'application/json' })
      }
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
      if (req.method === 'PUT' && !(await env.KV.get(`a/${id}`)) && (await tooMany(env, req, 'nuovo'))) return reply('troppe richieste', 429)
      const auth = await checkAuth(env, id, req.headers.get('Authorization'), req.method === 'PUT')
      if (!auth) return reply('non autorizzato', 403)

      if (req.method === 'PUT') {
        if (!key || part === 'v') return reply('non trovato', 404)
        const body = await req.arrayBuffer()
        if (body.byteLength > (photo ? MAX_PHOTO : MAX_INDEX)) return reply('troppo grande', 413)
        const version = req.headers.get('X-Version') ?? String(Date.now())
        await env.KV.put(key, body, part === 'm' ? { metadata: { v: version } } : undefined)
        // Data dell'ultimo aggiornamento, per la pagina di stato (non blocca la risposta).
        if (part === 'm') ctx.waitUntil(counter(env).shareSeen(id).catch(() => {}))
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
      // L'id resta revocato per sempre (S9): nessuno può ricrearlo.
      await env.KV.put(`a/${id}`, REVOKED)
      ctx.waitUntil(counter(env).shareEnded(id).catch(() => {}))
      return reply('ok')
    } catch (e) {
      // Niente dettagli interni nella risposta.
      if (e instanceof Refused) return reply(e.message, e.status)
      return reply('errore', 500)
    }
  },

  /** Ogni 15 minuti: riepiloghi giornalieri all'ora scelta e novità rimaste in attesa. */
  async scheduled(_event, env) {
    const ids = (await env.KV.get('subs-index', 'json')) ?? []
    const left = []
    for (const id of ids) {
      // Un viaggio con iscrizioni guaste non deve fermare gli altri.
      try {
        const subs = await env.KV.get(`${id}/subs`, 'json')
        if (!subs || Object.keys(subs).length === 0) continue
        left.push(id)
        if (await flush(env, id, subs, false)) await env.KV.put(`${id}/subs`, JSON.stringify(subs))
      } catch {
        left.push(id)
      }
    }
    if (left.length !== ids.length) await env.KV.put('subs-index', JSON.stringify(left))
  },
}

// --- Notifiche ---------------------------------------------------------------

/** Impronta dell'indirizzo push, come la calcola l'app (sha256 in base64url). */
async function subHash(endpoint) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(endpoint))))
}

async function subscribe(env, id, body) {
  const { h, endpoint, keys, mode, hour, tz } = body ?? {}
  // Campi controllati uno per uno (S4): niente indirizzi qualsiasi né campi enormi.
  let host = ''
  try {
    if (typeof endpoint === 'string' && endpoint.length <= 1024 && endpoint.startsWith('https://')) host = new URL(endpoint).hostname
  } catch {
    // indirizzo non valido
  }
  if (!PUSH_HOSTS.some((r) => r.test(host))) throw new Refused(400, 'iscrizione non valida')
  if (typeof keys?.p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh) || typeof keys?.auth !== 'string' || !/^[A-Za-z0-9_-]{22}(==)?$/.test(keys.auth)) throw new Refused(400, 'iscrizione non valida')
  if (typeof h !== 'string' || h !== (await subHash(endpoint))) throw new Refused(400, 'iscrizione non valida')
  if (mode !== 'each' && mode !== 'daily') throw new Refused(400, 'modalità non valida')
  if (typeof tz !== 'string' || tz.length > 64) throw new Refused(400, 'fuso non valido')
  // Solo viaggi condivisi adesso: niente iscrizioni a id inventati o revocati.
  const auth = await env.KV.get(`a/${id}`)
  if (!auth || auth === REVOKED) throw new Refused(404, 'viaggio non condiviso')
  const subs = (await env.KV.get(`${id}/subs`, 'json')) ?? {}
  if (!subs[h] && Object.keys(subs).length >= SUBS_MAX) throw new Refused(429, 'troppe iscrizioni')
  const old = subs[h]
  subs[h] = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, mode, hour: Math.min(23, Math.max(0, Number(hour) || 20)), tz: tz || 'Europe/Rome', last: old?.last, day: old?.day, queue: old?.queue ?? [] }
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
    let status = 0
    try {
      status = await sendPush(env, s, JSON.stringify({ s: id, d: daily ? 1 : 0, m: s.queue }))
    } catch {
      // Iscrizione guasta (chiavi illeggibili): si toglie.
      status = 410
    }
    changed = true
    if (status === 404 || status === 410) {
      // Iscrizione scaduta o notifiche disattivate sul telefono.
      delete subs[h]
      continue
    }
    // Errore momentaneo (rete, troppe richieste, servizio push giù): la coda resta,
    // si riprova al prossimo giro. Il riepilogo del giorno si ritenta nella stessa ora.
    if (status === 0 || status === 429 || status >= 500) {
      if (daily) s.day = undefined
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
  if (stored) return stored !== REVOKED && stored === hash
  if (!mayCreate) return false
  await env.KV.put(`a/${id}`, hash)
  return true
}

// --- Conteggio e pagina di stato ---------------------------------------------

/** Il contatore è uno solo per tutto il server. */
const counter = (env) => env.CONTA.get(env.CONTA.idFromName('mytrip'))

function validPing(t) {
  return (
    !!t &&
    typeof t.i === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t.i) &&
    typeof t.v === 'string' &&
    /^[0-9A-Za-z.+-]{1,24}$/.test(t.v) &&
    (t.m === 'app' || t.m === 'browser') &&
    (t.o === 'ios' || t.o === 'android' || t.o === 'desktop')
  )
}

/** Confronto del segreto senza dare indizi col tempo di risposta. */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc(s))))
  return crypto.subtle.timingSafeEqual(x, y)
}

/**
 * Telefoni (dal contatore) e viaggi condivisi adesso (da KV: permesso attivo,
 * numero di foto, iscritti alle notifiche). Chi segue senza notifiche non si
 * vede: legge e basta, senza lasciare traccia. Solo letture di KV.
 */
async function statusReport(env) {
  const { telefoni, condivisioni } = await counter(env).report()
  const dates = new Map(condivisioni.map((c) => [c.id, c]))
  const shares = []
  let revoked = 0
  let cursor
  do {
    const page = await env.KV.list({ prefix: 'a/', cursor })
    for (const k of page.keys) {
      const id = k.name.slice(2)
      if ((await env.KV.get(k.name)) === REVOKED) {
        revoked++
        continue
      }
      const photos = await env.KV.list({ prefix: `${id}/p/` })
      const subs = (await env.KV.get(`${id}/subs`, 'json')) ?? {}
      const d = dates.get(id)
      // Solo l'inizio del codice: basta a distinguerli, e la pagina non dà il link.
      shares.push({ id: id.slice(0, 6), photos: photos.list_complete ? photos.keys.length : `${photos.keys.length}+`, subs: Object.keys(subs).length, first: d?.primo, last: d?.ultimo })
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return { now: Date.now(), telefoni, shares, revoked }
}

/** Archivio SQLite del conteggio: una riga per telefono, una per viaggio condiviso. */
export class Contatore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS telefoni (id TEXT PRIMARY KEY, primo INTEGER, ultimo INTEGER, versione TEXT, modo TEXT, sistema TEXT)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS condivisioni (id TEXT PRIMARY KEY, primo INTEGER, ultimo INTEGER, fine INTEGER)')
  }

  ping(t) {
    const now = Date.now()
    this.sql.exec(
      'INSERT INTO telefoni VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ultimo = excluded.ultimo, versione = excluded.versione, modo = excluded.modo, sistema = excluded.sistema',
      t.i,
      now,
      now,
      t.v,
      t.m,
      t.o,
    )
  }

  shareSeen(id) {
    const now = Date.now()
    this.sql.exec('INSERT INTO condivisioni VALUES (?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET ultimo = excluded.ultimo', id, now, now)
  }

  shareEnded(id) {
    this.sql.exec('UPDATE condivisioni SET fine = ? WHERE id = ?', Date.now(), id)
  }

  report() {
    return {
      telefoni: this.sql.exec('SELECT primo, ultimo, versione, modo, sistema FROM telefoni').toArray(),
      condivisioni: this.sql.exec('SELECT id, primo, ultimo FROM condivisioni WHERE fine IS NULL').toArray(),
    }
  }
}

/** La pagina di stato: legge la chiave dopo il «#» e chiede i dati. */
const STATO_HTML = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>MyTrip · stato</title>
<style>
body{font:16px/1.45 -apple-system,system-ui,sans-serif;margin:0 auto;padding:16px;background:#f4f1e8;color:#1d2a24;max-width:640px}
h1{font-size:22px;margin:4px 0 2px}h2{font-size:17px;margin:22px 0 8px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.box{background:#fff;border-radius:10px;padding:10px 12px}.box b{display:block;font-size:24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden}
td,th{padding:7px 10px;text-align:left;border-bottom:1px solid #eee;font-size:14px}
.small{font-size:13px;color:#5b6660}.old{color:#a3432a;font-weight:600}
</style></head><body>
<h1>MyTrip · stato</h1><p class="small" id="when">Carico…</p><div id="out"></div>
<script>
const key = decodeURIComponent(location.hash.slice(1))
const out = document.getElementById('out')
const when = document.getElementById('when')
const DAY = 86400000
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fmt = (ms) => (ms ? new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–')
const group = (list, f) => Object.entries(list.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])
const rows = (pairs) => (pairs.length ? '<table>' + pairs.map(([k, n]) => '<tr><td>' + esc(k) + '</td><td>' + n + '</td></tr>').join('') + '</table>' : '<p class="small">Nessuna.</p>')
async function load() {
  if (!key) { when.textContent = 'Manca la chiave: apri il link completo, con la parte dopo il #.'; return }
  const r = await fetch('/stato/dati', { headers: { Authorization: 'Bearer ' + key }, cache: 'no-store' })
  if (!r.ok) { when.textContent = r.status === 403 ? 'Chiave non valida.' : 'Il server non risponde.'; return }
  const d = await r.json()
  const t = d.telefoni
  const active = (n) => t.filter((x) => d.now - x.ultimo < n * DAY)
  const m30 = active(30)
  when.textContent = 'Aggiornato ' + fmt(d.now) + '. Ogni app si fa contare al massimo una volta al giorno, quando si apre.'
  let h = '<h2>App in uso</h2><div class="grid">'
  h += '<div class="box"><b>' + active(1).length + '</b>nelle ultime 24 ore</div>'
  h += '<div class="box"><b>' + active(7).length + '</b>negli ultimi 7 giorni</div>'
  h += '<div class="box"><b>' + m30.length + '</b>negli ultimi 30 giorni</div>'
  h += '<div class="box"><b>' + t.length + '</b>viste in tutto</div>'
  h += '<div class="box"><b>' + t.filter((x) => d.now - x.primo < 7 * DAY).length + '</b>nuove negli ultimi 7 giorni</div></div>'
  h += '<h2>Ultimi 30 giorni, per versione</h2>' + rows(group(m30, (x) => x.versione))
  h += '<h2>Installata o nel browser</h2>' + rows(group(m30, (x) => (x.modo === 'app' ? 'installata' : 'nel browser') + ' · ' + x.sistema))
  h += '<h2>Viaggi condivisi adesso: ' + d.shares.length + '</h2>'
  if (d.shares.length) {
    h += '<table><tr><th>Codice</th><th>Foto</th><th>Notifiche</th><th>Ultimo aggiornamento</th></tr>'
    for (const s of d.shares.sort((a, b) => (b.last || 0) - (a.last || 0))) {
      const age = s.last ? Math.floor((d.now - s.last) / DAY) : null
      h += '<tr><td>' + esc(s.id) + '…</td><td>' + esc(s.photos) + '</td><td>' + s.subs + '</td><td' + (age !== null && age > 14 ? ' class="old"' : '') + '>' + fmt(s.last) + (age ? ' · ' + age + ' g fa' : '') + '</td></tr>'
    }
    h += '</table>'
  }
  h += '<p class="small">Condivisioni interrotte: ' + d.revoked + '. In rosso quelle ferme da più di 14 giorni. «Notifiche» conta chi segue con le notifiche accese, chi segue senza notifiche non si vede. Un trattino vuol dire nessun aggiornamento da quando c’è il contatore.</p>'
  out.innerHTML = h
}
load().catch(() => { when.textContent = 'Il server non risponde.' })
</script></body></html>`
