import { liveQuery } from 'dexie'
import { useSyncExternalStore } from 'react'
import { asStored, db, toStored, type Photo, type Route, type Share, type Stop, type Trip } from './db'
import { decrypt, encrypt, fromB64url, randomB64url, sha256, toB64url } from './crypt'
import { forgetThumbs } from './thumbUrl'
import { getProfile } from './profile'

/**
 * VIAGGI CONDIVISI IN DIRETTA (richiesta dell'utente, 30/10/2026)
 *
 * Chi viaggia condivide un viaggio; chi riceve il link lo segue in sola lettura
 * e vede le foto nuove man mano. Solo per i viaggi condivisi: gli altri non
 * lasciano mai il telefono, e senza condivisioni l'app non contatta il server.
 *
 * - Server: Cloudflare Worker + Workers KV (`server/worker.js`), che conserva
 *   solo dati cifrati (crypt.ts). La chiave sta nel link, dopo il «#».
 * - Sul server: un indice (viaggio, tappe, percorsi, elenco delle foto, gzip)
 *   e una miniatura per foto. Chi viaggia carica solo le foto nuove o cambiate
 *   (`Share.sent`) e l'indice solo se è cambiato (`Share.v` = impronta).
 * - Chi segue chiede prima la versione dell'indice (pochi byte): scarica
 *   l'indice solo se è cambiato, e solo le miniature che non ha.
 * - ⚠️ Niente invio in sottofondo su iOS: le novità partono con l'app aperta;
 *   senza rete si riprova al ritorno della connessione o al prossimo avvio.
 */
export const SYNC_URL = 'https://mytrip-sync.mytrip-viaggi.workers.dev'

type PhotoMeta = Omit<Photo, 'thumb'> & { size: number }
interface Index {
  app: 'mytrip'
  v: 1
  trip: Omit<Trip, 'coverImage'> & { coverImage?: undefined }
  stops: Stop[]
  routes: Route[]
  photos: PhotoMeta[]
  /** Nome di chi viaggia (Impostazioni › Il viaggiatore), facoltativo. */
  by?: string
}

/** Quanto l'avviso per chi segue aspetta i nomi dei luoghi delle foto nuove. */
const NOTE_WAIT_MS = 2 * 60_000

/** Foto caricate o scaricate insieme. */
const PARALLEL = 4

// --- Stato da mostrare (avanzamento) -----------------------------------------

export interface SyncStatus {
  busy?: boolean
  done?: number
  total?: number
}
const status = new Map<string, SyncStatus>()
const listeners = new Set<() => void>()
const IDLE: SyncStatus = {}

function setStatus(tripId: string, s: SyncStatus): void {
  status.set(tripId, s)
  for (const l of listeners) l()
}

export function useSyncStatus(tripId: string): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => status.get(tripId) ?? IDLE,
  )
}

// --- Rete --------------------------------------------------------------------

function explain(status: number): string {
  if (status === 403) return 'Permesso di scrittura non valido.'
  if (status === 413) return 'Dati troppo grandi per il server.'
  if (status === 429 || status >= 500) return 'Il server non risponde ora (forse il limite giornaliero): riprovo più tardi.'
  return `Errore del server (${status}).`
}

async function call(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, share: Share, body?: Uint8Array<ArrayBuffer>, version?: string): Promise<Response | null> {
  let r: Response
  try {
    r = await fetch(`${SYNC_URL}/s/${share.id}${path}`, {
      method,
      body,
      cache: 'no-store',
      headers: {
        ...(method !== 'GET' && share.token ? { Authorization: `Bearer ${share.token}` } : {}),
        ...(version ? { 'X-Version': version } : {}),
      },
    })
  } catch {
    throw new Error('Connessione assente o server non raggiungibile.')
  }
  if (r.status === 404 && method === 'GET') return null
  if (!r.ok) throw new Error(explain(r.status))
  return r
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(data: ArrayBuffer): Promise<string> {
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

const name = (share: Share, part: string) => `${share.id}/${part}`

async function putPiece(share: Share, part: string, data: BufferSource, version?: string): Promise<void> {
  await call('PUT', `/${part}`, share, await encrypt(share.key, data, name(share, part)), version)
}

async function getPiece(share: Share, part: string): Promise<ArrayBuffer | null> {
  const r = await call('GET', `/${part}`, share)
  if (!r) return null
  try {
    return await decrypt(share.key, await r.arrayBuffer(), name(share, part))
  } catch {
    throw new Error('Il link non è corretto: i dati non si decifrano.')
  }
}

async function getIndex(share: Share): Promise<Index | null> {
  const raw = await getPiece(share, 'm')
  if (!raw) return null
  const index = JSON.parse(await gunzip(raw)) as Index
  if (index?.app !== 'mytrip' || index.v !== 1) throw new Error("Il viaggio viene da una versione più recente dell'app: aggiornala.")
  return index
}

/** Un solo giro alla volta per viaggio; una richiesta arrivata a metà ne fa partire un altro alla fine. */
const running = new Map<string, Promise<void>>()
const again = new Set<string>()
function single(tripId: string, job: () => Promise<void>): Promise<void> {
  const current = running.get(tripId)
  if (current) {
    again.add(tripId)
    return current
  }
  const p = (async () => {
    try {
      do {
        again.delete(tripId)
        await job()
      } while (again.has(tripId))
    } finally {
      running.delete(tripId)
      setStatus(tripId, IDLE)
    }
  })()
  running.set(tripId, p)
  return p
}

// --- Chi viaggia -------------------------------------------------------------

/** Carica le novità di un viaggio condiviso. Gli errori restano in `Share.error`. */
export function pushShare(tripId: string): Promise<void> {
  return single(tripId, () => pushOnce(tripId))
}

async function pushOnce(tripId: string): Promise<void> {
  const share = await db.shares.get(tripId)
  if (share?.role !== 'owner') return
  const trip = await db.trips.get(tripId)
  if (!trip) return
  const sent = { ...(share.sent ?? {}) }
  let changed = false
  let note = share.note
  try {
    const stops = await db.stops.where('tripId').equals(tripId).sortBy('start')
    const photos = await db.photos.where('tripId').equals(tripId).toArray()
    const routes = await db.routes.where('tripId').equals(tripId).toArray()

    // Foto nuove per l'avviso a chi segue (non alla prima condivisione). Si
    // segnano PRIMA di caricarle: se il caricamento si interrompe, l'avviso resta.
    const fresh = share.v ? photos.filter((p) => !(p.id in sent)).map((p) => p.id) : []
    if (fresh.length) note = { ids: [...new Set([...(note?.ids ?? []), ...fresh])], since: note?.since ?? Date.now() }

    // Miniature (e copertina caricata a mano) nuove o cambiate.
    const blobs = photos.map((p) => ({ id: p.id, blob: p.thumb }))
    if (trip.coverImage && trip.coverImageId) blobs.push({ id: trip.coverImageId, blob: trip.coverImage })
    const todo = blobs.filter((b) => sent[b.id] !== b.blob.size)
    for (let i = 0; i < todo.length; i += PARALLEL) {
      setStatus(tripId, { busy: true, done: i, total: todo.length })
      await Promise.all(
        todo.slice(i, i + PARALLEL).map(async (b) => {
          await putPiece(share, `p/${b.id}`, await b.blob.arrayBuffer())
          sent[b.id] = b.blob.size
          changed = true
        }),
      )
    }

    // L'indice, solo se è cambiato. Prima le foto, poi l'indice: chi segue
    // non trova mai nell'elenco una foto che non è ancora sul server.
    const index: Index = {
      app: 'mytrip',
      v: 1,
      trip: { ...trip, coverImage: undefined },
      stops,
      routes,
      photos: photos.map((p) => ({ ...p, thumb: undefined, size: p.thumb.size })),
      by: getProfile().name,
    }
    const json = JSON.stringify(index)
    const v = await sha256(json)
    if (v !== share.v) {
      setStatus(tripId, { busy: true })
      await putPiece(share, 'm', await gzip(json), v)
    }

    // Notifica per chi segue: solo foto NUOVE (non la prima condivisione, non le
    // miniature ricaricate). Il testo è cifrato con la chiave del viaggio: il
    // server lo inoltra senza leggerlo (public/push-sw.js lo decifra).
    // ⚠️ Le foto partono subito dopo l'import, quando i nomi dei luoghi non ci
    // sono ancora (Nominatim, una richiesta al secondo): l'avviso aspetta i nomi,
    // al massimo NOTE_WAIT_MS, poi parte comunque.
    const ids = new Set(photos.map((p) => p.id))
    if (note) {
      note = { ...note, ids: note.ids.filter((id) => ids.has(id)) }
      const stopIds = new Set(photos.filter((p) => note!.ids.includes(p.id)).map((p) => p.stopId))
      const ours = stops.filter((s) => stopIds.has(s.id))
      const named = ours.every((s) => s.geocoded)
      if (note.ids.length === 0) note = undefined
      else if (named || Date.now() - note.since > NOTE_WAIT_MS) {
        const places = [...new Set(ours.map((s) => s.name ?? s.place).filter((n): n is string => !!n))].slice(0, 4)
        const msg = await encrypt(share.key, new TextEncoder().encode(JSON.stringify({ n: note.ids.length, p: places })), name(share, 'n'))
        await call('POST', '/n', share, new TextEncoder().encode(JSON.stringify({ c: toB64url(msg) }))).catch(() => {})
        note = undefined
      } else setTimeout(() => void pushShare(tripId), NOTE_WAIT_MS)
    }
    if (JSON.stringify(note) !== JSON.stringify(share.note)) changed = true

    // Foto tolte dal viaggio: via anche dal server.
    const keep = new Set(blobs.map((b) => b.id))
    for (const id of Object.keys(sent)) {
      if (keep.has(id)) continue
      await call('DELETE', `/p/${id}`, share)
      delete sent[id]
      changed = true
    }
    // ⚠️ Si scrive solo se qualcosa è cambiato: la scrittura sveglia `watch`,
    // che rifà un giro; quel giro non trova novità e si ferma lì.
    if (changed || v !== share.v || share.error) await db.shares.update(tripId, { sent, v, note, at: Date.now(), error: undefined })
  } catch (e) {
    await db.shares.update(tripId, { sent, note, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Inizia a condividere: crea id, chiave e permesso, poi carica tutto. */
export async function startSharing(tripId: string): Promise<void> {
  await db.shares.put({ tripId, role: 'owner', id: randomB64url(16), key: randomB64url(32), token: randomB64url(32) })
  await pushShare(tripId)
  const share = await db.shares.get(tripId)
  if (share?.error) throw new Error(share.error)
}

/** Smette di condividere: cancella tutto dal server. Chi segue tiene ciò che ha già scaricato. */
export async function stopSharing(tripId: string): Promise<void> {
  const share = await db.shares.get(tripId)
  if (share?.role !== 'owner') return
  await call('DELETE', '', share)
  await db.shares.delete(tripId)
}

/** Il link per chi segue: la chiave sta dopo il «#», e il «#» non arriva mai al server. */
export function followLink(share: Share): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/segui/${share.id}.${share.key}`
}

// --- Chi segue ---------------------------------------------------------------

/** Trova id e chiave in un link o in un codice incollato. */
export function parseFollowCode(text: string): { id: string; key: string } | undefined {
  const m = /([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})/.exec(text)
  return m ? { id: m[1], key: m[2] } : undefined
}

/** Inizia a seguire un viaggio; restituisce il suo id. */
export async function follow(code: { id: string; key: string }): Promise<string> {
  const probe: Share = { tripId: '', role: 'follow', ...code }
  const index = await getIndex(probe)
  if (!index) throw new Error('Viaggio non trovato: forse non è più condiviso.')
  const tripId = index.trip.id
  const existing = await db.shares.get(tripId)
  if (existing?.role === 'owner') throw new Error('Questo viaggio lo stai condividendo tu.')
  await db.shares.put({ ...probe, tripId })
  await pullShare(tripId)
  const share = await db.shares.get(tripId)
  if (share?.error) throw new Error(share.error)
  return tripId
}

/** Scarica le novità di un viaggio seguito. */
export function pullShare(tripId: string): Promise<void> {
  return single(tripId, () => pullOnce(tripId))
}

const ENDED = 'Il viaggio non è più condiviso: resta quello che hai già scaricato.'

async function pullOnce(tripId: string): Promise<void> {
  const share = await db.shares.get(tripId)
  if (share?.role !== 'follow') return
  // Chi viaggia ha smesso di condividere: da qui il viaggio vive solo su questo telefono.
  const ended = () => db.shares.update(tripId, { ended: share.ended ?? Date.now(), error: ENDED })
  try {
    const r = await call('GET', '/v', share)
    if (!r) return void (await ended())
    const v = await r.text()
    if (v === share.v) {
      if (share.error || share.ended) await db.shares.update(tripId, { error: undefined, ended: undefined })
      return
    }
    setStatus(tripId, { busy: true })
    const index = await getIndex(share)
    if (!index) return void (await ended())
    if (index.trip.id !== tripId) throw new Error('Il link non corrisponde a questo viaggio.')

    // Prima la struttura (tappe, percorsi), così il viaggio si vede subito;
    // poi le miniature mancanti, a gruppi.
    const local = await db.photos.where('tripId').equals(tripId).toArray()
    const old = await db.trips.get(tripId)
    const stopIds = new Set(index.stops.map((s) => s.id))
    const routeIds = new Set(index.routes.map((x) => x.id))
    const photoIds = new Set(index.photos.map((p) => p.id))
    // Immagini già qui che si riscrivono: in byte PRIMA della transazione (db.ts).
    const sameCover = old?.coverImageId && old.coverImageId === index.trip.coverImageId
    const cover = sameCover && old.coverImage ? await toStored(old.coverImage) : undefined
    const have = new Map(local.map((p) => [p.id, p]))
    const moved = await Promise.all(
      index.photos.flatMap((p) => {
        const mine = have.get(p.id)
        return mine && mine.thumb.size === p.size && mine.stopId !== p.stopId ? [toStored(mine.thumb).then((thumb) => ({ ...mine, ...withoutSize(p), thumb }))] : []
      }),
    )
    await db.transaction('rw', [db.trips, db.stops, db.routes, db.photos], async () => {
      await db.trips.put({ ...index.trip, coverImage: cover })
      await db.stops.bulkDelete((await db.stops.where('tripId').equals(tripId).primaryKeys()).filter((id) => !stopIds.has(id)))
      await db.stops.bulkPut(index.stops)
      await db.routes.bulkDelete((await db.routes.where('tripId').equals(tripId).primaryKeys()).filter((id) => !routeIds.has(id)))
      await db.routes.bulkPut(index.routes)
      const gone = local.filter((p) => !photoIds.has(p.id)).map((p) => p.id)
      forgetThumbs(gone)
      await db.photos.bulkDelete(gone)
      // Foto spostate da una tappa all'altra (unire, dividere): basta il dato nuovo.
      await db.photos.bulkPut(moved)
    })

    const sizes = new Map(local.map((p) => [p.id, p.thumb.size]))
    const todo = index.photos.filter((p) => sizes.get(p.id) !== p.size)
    for (let i = 0; i < todo.length; i += PARALLEL) {
      setStatus(tripId, { busy: true, done: i, total: todo.length })
      const got = await Promise.all(
        todo.slice(i, i + PARALLEL).map(async (p): Promise<Photo | undefined> => {
          const data = await getPiece(share, `p/${p.id}`)
          return data ? { ...withoutSize(p), thumb: asStored(data) } : undefined
        }),
      )
      const ok = got.filter((p): p is Photo => !!p)
      forgetThumbs(ok.map((p) => p.id))
      await db.photos.bulkPut(ok)
    }

    const coverId = index.trip.coverImageId
    if (coverId && !(old?.coverImageId === coverId && old.coverImage)) {
      const data = await getPiece(share, `p/${coverId}`)
      if (data) {
        forgetThumbs([coverId])
        await db.trips.update(tripId, { coverImage: asStored(data) })
      }
    }
    // Versione segnata solo a lavoro finito: se qualcosa è mancato, si riprova al prossimo giro.
    const complete = (await db.photos.where('tripId').equals(tripId).count()) === index.photos.length
    await db.shares.update(tripId, { v: complete ? v : undefined, at: Date.now(), error: undefined, ended: undefined, by: index.by })
  } catch (e) {
    await db.shares.update(tripId, { error: e instanceof Error ? e.message : String(e) })
  }
}

function withoutSize(p: PhotoMeta): Omit<Photo, 'thumb'> {
  const copy: Partial<PhotoMeta> = { ...p }
  delete copy.size
  return copy as Omit<Photo, 'thumb'>
}

// --- Notifiche per chi segue ---------------------------------------------------

/**
 * Chiave pubblica VAPID del server (la privata è il segreto `VAPID_JWK` del
 * Worker). ⚠️ Se si cambia, le iscrizioni esistenti smettono di funzionare e
 * chi segue deve riattivare le notifiche.
 */
const VAPID_PUBLIC = 'BJ2N99fy49gCtlXSlnXQBz07XrFyJWBmvChiViz257eMB01pxowLtve8sNtgYQUn8hZu8skP_zAbQEjYqCbAeJo'

export type NotifyMode = 'each' | 'daily'

/** Le notifiche web su iPhone esistono solo nell'app installata sulla Home (iOS 16.4+). */
export function notificationsSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * Attiva, cambia o spegne le notifiche di un viaggio seguito. ⚠️ Va chiamata
 * direttamente dal tocco: iOS chiede il permesso solo subito dopo un gesto.
 */
export async function setNotify(tripId: string, pref: { mode: NotifyMode; hour: number } | null): Promise<void> {
  const permission = pref ? Notification.requestPermission() : undefined
  const share = await db.shares.get(tripId)
  if (share?.role !== 'follow') return
  if (!pref) {
    if (share.notify) await call('DELETE', `/sub/${share.notify.sub}`, share)
    await db.shares.update(tripId, { notify: undefined })
    return
  }
  if ((await permission) !== 'granted') throw new Error("Notifiche non permesse. Si attivano nelle Impostazioni dell'iPhone › Notifiche › MyTrip.")
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(VAPID_PUBLIC) }))
  const json = sub.toJSON()
  const h = await sha256(json.endpoint ?? '')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  await call('POST', '/sub', share, new TextEncoder().encode(JSON.stringify({ h, endpoint: json.endpoint, keys: json.keys, mode: pref.mode, hour: pref.hour, tz })))
  await db.shares.update(tripId, { notify: { ...pref, sub: h } })
}

/**
 * Prima di eliminare un viaggio condiviso o seguito: chi viaggia lo toglie dal
 * server, chi segue toglie la sua iscrizione alle notifiche.
 */
export async function leaveShare(tripId: string): Promise<void> {
  const share = await db.shares.get(tripId)
  if (share?.role === 'owner') await stopSharing(tripId)
  else if (share?.notify) await setNotify(tripId, null)
}

// --- Quando sincronizzare ----------------------------------------------------

const PULL_EVERY_MS = 5 * 60_000
const PUSH_DELAY_MS = 4000

/** Carica le novità di tutti i viaggi condivisi (anche dopo un cambio di nome del viaggiatore). */
export async function pushAll(): Promise<void> {
  for (const s of await db.shares.where('role').equals('owner').toArray()) await pushShare(s.tripId)
}

export async function pullAll(): Promise<void> {
  for (const s of await db.shares.where('role').equals('follow').toArray()) await pullShare(s.tripId)
}

let started = false

/**
 * All'avvio: carica le novità rimaste in coda e scarica quelle dei viaggi seguiti.
 * Poi: ogni modifica a un viaggio condiviso parte dopo qualche secondo (le
 * modifiche ravvicinate partono insieme); chi segue riguarda ogni 5 minuti con
 * l'app aperta, e ogni volta che l'app torna in primo piano.
 */
export function startSync(): void {
  if (started) return
  started = true
  void pushAll()
  void pullAll()

  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = new Set<string>()
  liveQuery(async () => {
    const owners = await db.shares.where('role').equals('owner').toArray()
    for (const s of owners) {
      await db.trips.get(s.tripId)
      await db.stops.where('tripId').equals(s.tripId).toArray()
      await db.routes.where('tripId').equals(s.tripId).primaryKeys()
      await db.photos.where('tripId').equals(s.tripId).primaryKeys()
    }
    return owners.map((s) => s.tripId)
  }).subscribe((ids) => {
    pending = new Set([...pending, ...ids])
    clearTimeout(timer)
    timer = setTimeout(() => {
      const list = [...pending]
      pending = new Set()
      for (const id of list) void pushShare(id)
    }, PUSH_DELAY_MS)
  })

  window.addEventListener('online', () => {
    void pushAll()
    void pullAll()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pullAll()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') void pullAll()
  }, PULL_EVERY_MS)
}
