import { asStored, db, stopSummary, type Photo, type Route, type Share, type Stop, type Trip } from './db'
import { forgetThumbs } from './thumbUrl'
import { currentPushSub, NEEDS_NEWER } from './sync'
import { cleanGrouping, getGrouping, setGrouping, type Grouping } from './grouping'
import type { Progress } from './exportFlow'
import { shareThumb } from './shareThumb'
import { getProfile } from './profile'
import { setBusy } from './update'

/**
 * File di export: un viaggio singolo o il backup di tutti.
 *
 * ⚠️ Il formato resta `1`: campi nuovi sì, ma facoltativi in lettura. Un file
 * esportato oggi deve entrare anche fra un anno, e anche nell'app di un'altra
 * persona (es. sul suo computer).
 */
const APP = 'mytrip'
const FORMAT = 1

export type PhotoFile = Omit<Photo, 'thumb'> & { thumb: string }
/** `coverImage` facoltativo: i file esportati prima della 0.2.0 non lo hanno. */
type TripFile = Omit<Trip, 'coverImage'> & { coverImage?: string }

export interface ExportFile {
  app: typeof APP
  format: number
  kind: 'trip' | 'backup'
  exportedAt: string
  trips: TripFile[]
  stops: Stop[]
  photos: PhotoFile[]
  /** Percorsi stimati fra le tappe (dalla 0.6.0, facoltativi: i file più vecchi non li hanno). */
  routes?: Route[]
  /** Miniature ridotte per condividere (shareThumb.ts): all'import non sostituiscono quelle già presenti. */
  lite?: boolean
  /**
   * Solo nel backup completo (dalla 0.14.0): i viaggi condivisi e seguiti, con il
   * permesso di scrittura. Così, ripristinando su un telefono nuovo, si continua
   * ad aggiornare il viaggio condiviso. ⚠️ Mai negli export da mandare ad altri.
   */
  shares?: Share[]
  /** Solo nel backup completo (dalla 0.19.0): come si raggruppano le foto in tappe (grouping.ts). */
  grouping?: Grouping
  /**
   * Solo negli export da mandare ad altri (dalla 0.22.0): il nome del viaggiatore
   * di chi esporta. Le sue foto escono con `by` = questo nome, così chi unisce il
   * viaggio al suo sa di chi sono (merge.ts).
   */
  by?: string
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Decodifica a mano invece di `fetch(dataUrl)`: è sincrona, non passa dalla
 * rete né dal service worker, e su Safari produce un Blob «normale» che
 * IndexedDB conserva senza sorprese.
 */
/** Byte da scrivere nell'archivio (mai Blob: vedi db.ts). */
export function dataUrlToStored(url: string): Blob {
  const comma = url.indexOf(',')
  const bin = atob(url.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return asStored(bytes)
}

/** Foto convertite insieme: abbastanza per andare veloci, non tante da riempire la memoria. */
const PARALLEL = 8
/** Foto lette dall'archivio (backup) o scritte (ripristino) per volta. */
const BATCH = 50

/**
 * ⚠️ BACKUP E RIPRISTINO A PEZZI (revisione di robustezza R2, 2/11/2026)
 *
 * Prima il backup leggeva tutte le foto insieme, le trasformava in testo e
 * componeva il file: in memoria c'erano 4–5 volte il peso delle miniature, e
 * lo stesso nel ripristino (tutto il file in una stringa sola). Con migliaia
 * di foto a 1080 px iOS chiude la pagina: il backup non si fa o, peggio, non
 * si riesce a rimetterlo su un telefono nuovo. Ora:
 * - il backup legge BATCH foto alla volta e le passa subito alla
 *   compressione: in memoria resta solo il file compresso che si forma;
 * - il ripristino legge il file a flusso due volte (`scan`): prima tutto
 *   tranne le miniature, per decidere cosa manca, poi solo le miniature da
 *   aggiungere, scritte BATCH alla volta.
 * Il contenuto del file è quello di sempre (formato 1, foto in fondo).
 */
async function build(kind: ExportFile['kind'], trips: Trip[], onProgress?: Progress, lite = false): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  // Da mandare ad altri: le foto senza autore sono di chi esporta. Il backup completo no.
  const by = kind === 'trip' ? getProfile().name : undefined
  const ids = trips.map((t) => t.id)
  const stops = await db.stops.where('tripId').anyOf(ids).toArray()
  const photoIds = await db.photos.where('tripId').anyOf(ids).primaryKeys()
  const routes = await db.routes.where('tripId').anyOf(ids).toArray()
  const shares = kind === 'backup' ? await db.shares.where('tripId').anyOf(ids).toArray() : []
  const tripFiles: TripFile[] = []
  for (const t of trips) tripFiles.push({ ...t, coverImage: t.coverImage ? await blobToDataUrl(t.coverImage) : undefined })

  const head: Omit<ExportFile, 'photos'> = { app: APP, format: FORMAT, kind, exportedAt: new Date().toISOString(), trips: tripFiles, stops, routes, ...(lite ? { lite } : {}), ...(shares.length ? { shares } : {}), ...(kind === 'backup' ? { grouping: getGrouping() } : {}), ...(by ? { by } : {}) }
  const text = new TextEncoder()
  const photoText = async (p: Photo) => JSON.stringify({ ...p, ...(by && !p.by ? { by } : {}), thumb: await blobToDataUrl(lite ? await shareThumb(p.thumb) : p.thumb) } satisfies PhotoFile)
  let next = 0
  let first = true
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(out) {
      onProgress?.(0, photoIds.length)
      out.enqueue(text.encode(`${JSON.stringify(head).slice(0, -1)},"photos":[`))
    },
    async pull(out) {
      if (next >= photoIds.length) {
        out.enqueue(text.encode(']}'))
        out.close()
        return
      }
      // Una foto tolta mentre si prepara il file manca e basta.
      const photos = (await db.photos.bulkGet(photoIds.slice(next, next + BATCH))).filter((p): p is Photo => !!p)
      const parts: string[] = []
      for (let i = 0; i < photos.length; i += PARALLEL) parts.push(...(await Promise.all(photos.slice(i, i + PARALLEL).map(photoText))))
      if (parts.length) {
        out.enqueue(text.encode((first ? '' : ',') + parts.join(',')))
        first = false
      }
      next += BATCH
      onProgress?.(Math.min(next, photoIds.length), photoIds.length)
    },
  })
}

/**
 * FILE COMPRESSO (30/10/2026, scelta dell'utente per mandarli più in fretta):
 * il contenuto è lo stesso JSON di sempre (formato 1), compresso con gzip dal
 * browser. Estensione `.mytrip`: non è un file da aprire a mano, si reimporta in
 * MyTrip (anche sul computer). Senza CompressionStream (browser vecchi) resta il
 * JSON in chiaro, `.mytrip.json`, e l'import li legge tutti e due.
 */
async function pack(json: ReadableStream<Uint8Array<ArrayBuffer>>, base: string): Promise<File> {
  if (typeof CompressionStream === 'undefined') return new File([await new Response(json).blob()], `${base}.mytrip.json`, { type: 'application/json' })
  const gz = await new Response(json.pipeThrough(new CompressionStream('gzip'))).blob()
  return new File([gz], `${base}.mytrip`, { type: 'application/octet-stream' })
}

/** Il testo di un file di MyTrip a pezzi, compresso o in chiaro (riconosce gzip dai primi due byte). */
async function* textOf(file: File): AsyncGenerator<string> {
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  let stream: ReadableStream<Uint8Array<ArrayBuffer>> = file.stream()
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error(NEEDS_NEWER)
    stream = stream.pipeThrough(new DecompressionStream('gzip'))
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let done = false
  try {
    while (!done) {
      const r = await reader.read()
      done = r.done
      const t = r.done ? decoder.decode() : decoder.decode(r.value, { stream: true })
      if (t) yield t
    }
  } finally {
    // Lettura lasciata a metà (un errore): si chiude il file.
    if (!done) void reader.cancel().catch(() => {})
  }
}

const NOT_MYTRIP = 'Questo non è un file di MyTrip.'
const UNREADABLE = 'Il file non è leggibile.'
const NEWER_APP = "Il file viene da una versione più recente dell'app: aggiornala e riprova."
/** Oltre questa lunghezza (caratteri) la parte senza foto non è di un file di MyTrip. */
const HEAD_MAX = 100_000_000

/**
 * Legge un file a flusso e passa a `onPhoto` il testo di ogni foto, una alla
 * volta; restituisce il resto del file, con `"photos":[]`. In memoria c'è
 * solo la foto che sta leggendo.
 *
 * Basta riconoscere stringhe e parentesi: l'elenco delle foto è il valore
 * della chiave `photos` dell'oggetto principale, ovunque sia. Nei file di oggi
 * è in fondo, in quelli di prima della 0.17 in mezzo (un unico JSON.stringify).
 */
async function scan(file: File, onPhoto: (json: string) => void | Promise<void>): Promise<string> {
  const head: string[] = []
  let headLength = 0
  let photo: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let key = ''
  let lastKey = ''
  let inPhotos = false
  let inPhoto = false
  let started = false
  for await (const chunk of textOf(file)) {
    if (!started) {
      // Un file che non comincia con «{» non è di MyTrip: lo si dice subito,
      // senza leggerlo tutto (una foto o un video scelto per sbaglio).
      const t = chunk.trimStart()
      if (!t) continue
      if (t[0] !== '{') throw new Error(NOT_MYTRIP)
      started = true
    }
    let headFrom = inPhotos ? -1 : 0
    let photoFrom = inPhoto ? 0 : -1
    let i = 0
    const n = chunk.length
    while (i < n) {
      if (inString) {
        if (escaped) {
          escaped = false
          i++
          continue
        }
        // Dentro una stringa (le miniature sono quasi tutto il file) si salta
        // subito alla fine o al prossimo «\».
        const quote = chunk.indexOf('"', i)
        const slash = chunk.indexOf('\\', i)
        const stop = slash !== -1 && (quote === -1 || slash < quote) ? slash : quote
        if (depth === 1 && key.length < 16) key += chunk.slice(i, Math.min(stop === -1 ? n : stop, i + 16))
        if (stop === -1) break
        i = stop + 1
        if (stop === slash) escaped = true
        else {
          inString = false
          if (depth === 1) lastKey = key
        }
        continue
      }
      const c = chunk[i]
      if (c === '"') {
        inString = true
        key = ''
      } else if (c === '{' || c === '[') {
        // Al primo livello un «[» è sempre il valore della chiave appena letta.
        if (!inPhotos && depth === 1 && c === '[' && lastKey === 'photos') {
          head.push(chunk.slice(headFrom, i + 1))
          headLength += i + 1 - headFrom
          headFrom = -1
          inPhotos = true
        } else if (inPhotos && depth === 2 && c === '{') {
          inPhoto = true
          photoFrom = i
        }
        depth++
      } else if (c === '}' || c === ']') {
        depth--
        if (inPhoto && depth === 2) {
          photo.push(chunk.slice(photoFrom, i + 1))
          const json = photo.join('')
          photo = []
          inPhoto = false
          await onPhoto(json)
        } else if (inPhotos && depth === 1) {
          inPhotos = false
          headFrom = i
        }
      }
      i++
    }
    if (headFrom >= 0) {
      head.push(chunk.slice(headFrom))
      headLength += n - headFrom
    }
    if (inPhoto) photo.push(chunk.slice(photoFrom))
    if (headLength > HEAD_MAX) throw new Error(NOT_MYTRIP)
  }
  return head.join('')
}

/** La parte del file senza le foto, controllata. */
function checkHead(text: string): ExportFile {
  let data: ExportFile
  try {
    data = JSON.parse(text) as ExportFile
  } catch {
    throw new Error(UNREADABLE)
  }
  if (data?.app !== APP || !Array.isArray(data.trips) || !Array.isArray(data.stops) || !Array.isArray(data.photos)) throw new Error(NOT_MYTRIP)
  if (typeof data.format !== 'number' || data.format > FORMAT) throw new Error(NEWER_APP)
  return data
}

/** Legge il file; gli errori diventano un messaggio per chi usa l'app. */
async function readFile(file: File, onPhoto: (p: PhotoFile) => void | Promise<void>): Promise<ExportFile> {
  // Un errore di `onPhoto` (per esempio l'archivio pieno) resta com'è: non è colpa del file.
  let theirs: { error: unknown } | undefined
  try {
    return checkHead(
      await scan(file, async (json) => {
        const p = JSON.parse(json) as PhotoFile
        try {
          await onPhoto(p)
        } catch (error) {
          theirs = { error }
          throw error
        }
      }),
    )
  } catch (e) {
    if (theirs) throw theirs.error
    if (e instanceof Error && [NEEDS_NEWER, NOT_MYTRIP, NEWER_APP].includes(e.message)) throw e
    throw new Error(UNREADABLE)
  }
}

/**
 * Tutto il file, miniature comprese. Solo per «Unisci un viaggio ricevuto»:
 * lì il file è l'export di qualche viaggio, non un backup completo.
 */
export async function readWhole(file: File): Promise<ExportFile> {
  const photos: PhotoFile[] = []
  const data = await readFile(file, (p) => void photos.push(p))
  return { ...data, photos }
}

/** Nome di file sicuro su ogni sistema. */
function safeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'viaggio'
}

/**
 * Uno o più viaggi scelti (Impostazioni › Backup e ripristino). Un solo viaggio
 * prende il suo nome; più viaggi stanno in un unico file, che si reimporta allo
 * stesso modo. Non conta come backup completo: per quello c'è `exportBackup`.
 * `lite` (predefinito, per WhatsApp): miniature ridotte (shareThumb.ts); senza,
 * «Qualità piena»: le miniature come sono, per unire il viaggio a quello di
 * un'altra persona senza perdere nitidezza (scelta dell'utente, 1/11/2026).
 */
export async function exportTrips(tripIds: string[], onProgress?: Progress, lite = true): Promise<File> {
  const trips = (await db.trips.bulkGet(tripIds)).filter((t): t is Trip => !!t)
  if (trips.length === 0) throw new Error('Nessun viaggio scelto')
  const base = trips.length === 1 ? safeName(trips[0].name) : `MyTrip-${trips.length}-viaggi-${today()}`
  return pack(await build('trip', trips, onProgress, lite), base)
}

/**
 * Data LOCALE per il nome dei file, «2026-10-30»: backup di giorni diversi
 * convivono nella stessa cartella (l'utente non vuole l'ora).
 * (toISOString darebbe la data di Greenwich: dopo mezzanotte il giorno prima.)
 */
function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function exportBackup(onProgress?: Progress): Promise<File> {
  // Un backup grande richiede tempo: l'app non si ricarica per un aggiornamento a metà.
  setBusy(true)
  try {
    return await pack(await build('backup', await db.trips.toArray(), onProgress), `MyTrip-backup-${today()}`)
  } finally {
    setBusy(false)
  }
}


export interface ImportSummary {
  trips: string[]
  /** Viaggi che sul telefono non c'erano. */
  newTrips: number
  /** Foto aggiunte. */
  photos: number
  /** Foto del file che c'erano già, lasciate come sono. */
  present: number
  /** Viaggi già presenti che hanno ricevuto giorni del diario o notti. */
  filled: number
}

/**
 * Peso stimato di «Esporta alcuni viaggi», per scegliere fra leggero e pieno.
 * Leggero: ~9 KB a foto (misurato sul Vietnam, 267 foto in 2,48 MB). Pieno: le
 * miniature come sono (il JPEG non si comprime e gzip riassorbe il base64).
 */
export const LITE_PHOTO_BYTES = 9 * 1024
export async function estimateExport(tripIds: string[]): Promise<{ lite: number; full: number }> {
  // Una foto alla volta: tutte insieme vorrebbe dire tutte le miniature in memoria.
  let count = 0
  let lite = 0
  let full = 0
  await db.photos.where('tripId').anyOf(tripIds).each((p) => {
    count++
    lite += Math.min(p.thumb.size, LITE_PHOTO_BYTES)
    full += p.thumb.size
  })
  const trips = (await db.trips.bulkGet(tripIds)).flatMap((t) => (t ? [t] : []))
  const covers = trips.reduce((s, t) => s + (t.coverImage?.size ?? 0), 0)
  const head = 2048 + count * 400
  return { lite: head + covers + lite, full: head + covers + full }
}

/** Una foto del file senza la miniatura: le miniature si leggono solo al momento di scriverle. */
export type PhotoInfo = Omit<PhotoFile, 'thumb'>

/** Un file letto, pronto da importare (`readImport` → `applyImport`). */
export interface ParsedImport {
  data: Omit<ExportFile, 'photos'> & { photos: PhotoInfo[] }
  /** Il file, che `applyImport` rilegge per le miniature da aggiungere. */
  file: File
  /**
   * Viaggi del file che riprenderebbero una condivisione in diretta (solo backup
   * completi). ⚠️ Si importano SOLO se chi importa lo conferma (`withShares`).
   */
  shareTrips: string[]
}

/**
 * ⚠️ SICUREZZA DELL'IMPORT (revisione del 1/11/2026, S1 e S2)
 *
 * Un file ricevuto può essere costruito apposta. Senza controlli:
 * - un «backup» con `shares` scelti da altri farebbe partire in silenzio una
 *   condivisione in diretta di un viaggio del telefono verso chi ha mandato il
 *   file, o lo farebbe «seguire» sovrascrivendolo;
 * - tappe, foto o percorsi con gli id di ALTRI viaggi del telefono (presi da un
 *   file esportato) li sovrascriverebbero.
 * Quindi: le condivisioni si riprendono solo con una conferma esplicita, mai su
 * un viaggio che sul telefono esiste già, e mai al posto di una condivisione
 * che c'è già; ogni scheda deve appartenere a un viaggio del file e non può
 * prendere il posto di una scheda di un altro viaggio.
 */
export async function readImport(file: File): Promise<ParsedImport> {
  const photos: PhotoInfo[] = []
  const head = await readFile(file, (p) => {
    const info: Partial<PhotoFile> = p
    delete info.thumb
    photos.push(info as PhotoInfo)
  })
  const data = { ...head, photos }
  // Si chiede solo per le condivisioni che si riprenderebbero davvero: quelle di
  // viaggi che sul telefono non ci sono ancora (le stesse regole di applyImport).
  // Ripristinando sullo stesso telefono non c'è niente da chiedere (2/11/2026:
  // la domanda compariva sotto il pulsante, fuori vista, e l'import sembrava fermo).
  const names = new Map(data.trips.map((t) => [t.id, t.name]))
  const shares = data.kind === 'backup' && Array.isArray(data.shares) ? data.shares : []
  const present = new Set((await db.trips.bulkGet(shares.map((s) => s.tripId))).flatMap((t) => (t ? [t.id] : [])))
  const taken = new Set((await db.shares.toArray()).map((s) => s.tripId))
  const shareTrips = shares
    .filter((s) => !present.has(s.tripId) && !taken.has(s.tripId))
    .map((s) => names.get(s.tripId))
    .filter((n): n is string => !!n)
  return { data, file, shareTrips }
}

/** Legge e importa, senza riprendere le condivisioni. */
export async function importFile(file: File): Promise<ImportSummary> {
  return applyImport(await readImport(file), false)
}

/**
 * Importa un viaggio o un backup. Gli id sono gli stessi dell'esportazione:
 * si aggiunge solo ciò che manca (vedi sotto). Niente si cancella e niente
 * torna indietro.
 */
export async function applyImport({ data, file }: ParsedImport, withShares: boolean, onProgress?: Progress): Promise<ImportSummary> {
  // Un ripristino grande richiede tempo: l'app non si ricarica per un aggiornamento a metà.
  setBusy(true)
  try {
    return await writeImport(data, file, withShares, onProgress)
  } finally {
    setBusy(false)
  }
}

/**
 * Di quale viaggio è ogni foto del file già sul telefono, senza leggere le
 * miniature (con un ripristino sullo stesso telefono sarebbero tutte). Una foto
 * con lo stesso id in un viaggio che non è nel file ha viaggio ''.
 */
async function photoOwners(ids: string[], trips: string[]): Promise<Map<string, string>> {
  const owner = new Map<string, string>()
  await db.photos.where('tripId').anyOf(trips).eachKey((tripId, cursor) => void owner.set(cursor.primaryKey as string, tripId as string))
  for (const id of await db.photos.where('id').anyOf(ids).primaryKeys()) if (!owner.has(id)) owner.set(id, '')
  return owner
}

async function writeImport(data: ParsedImport['data'], file: File, withShares: boolean, onProgress?: Progress): Promise<ImportSummary> {
  // Ogni scheda deve stare in un viaggio del file, e non può prendere il posto
  // di una scheda che sul telefono appartiene a un altro viaggio.
  const fileTrips = new Set(data.trips.map((t) => t.id))
  const owners = async (table: 'stops' | 'routes', ids: string[]) =>
    new Map((await db[table].bulkGet(ids)).flatMap((x) => (x ? [[x.id, x.tripId] as const] : [])))
  const stopOwner = await owners('stops', data.stops.map((s) => s.id))
  const photoOwner = await photoOwners(data.photos.map((p) => p.id), [...fileTrips])
  const routeOwner = await owners('routes', (data.routes ?? []).map((r) => r.id))
  const fits = (x: { id: string; tripId: string }, owner: Map<string, string>) => fileTrips.has(x.tripId) && (owner.get(x.id) ?? x.tripId) === x.tripId
  data = {
    ...data,
    stops: data.stops.filter((s) => fits(s, stopOwner)),
    photos: data.photos.filter((p) => fits(p, photoOwner)),
    routes: data.routes?.filter((r) => fits(r, routeOwner)),
  }

  // ⚠️ IL FILE AGGIUNGE SOLO CIÒ CHE MANCA (revisione di robustezza R1, scelta
  // dell'utente del 2/11/2026). Prima vinceva sempre il file: ripristinare un
  // backup vecchio per riavere un viaggio cancellato riportava indietro anche
  // tutti gli altri (note, nomi, diario, notti, tappe divise) senza dirlo.
  // Ora, come «Unisci» ma con gli stessi id:
  // - viaggi, tappe e foto che sul telefono ci sono già restano come sono;
  // - una foto entra solo se manca (né lo stesso id né la stessa impronta);
  // - una tappa del file entra solo se porta foto nuove; una che c'è già
  //   riceve le foto nuove e si ricalcolano centro e orari;
  // - di un viaggio che c'è già si aggiungono solo i giorni del diario e le
  //   notti che qui mancano.
  // Le foto tolte dopo il backup quindi tornano: meglio una foto in più da
  // togliere a mano che dati persi. Le miniature di qui non si toccano mai
  // (anche con un file «leggero»).
  const localTrips = new Map((await db.trips.bulkGet(data.trips.map((t) => t.id))).flatMap((t) => (t ? [[t.id, t] as const] : [])))
  const localStops = new Map((await db.stops.bulkGet(data.stops.map((s) => s.id))).flatMap((s) => (s ? [[s.id, s] as const] : [])))
  const knownKeys = new Set(await db.photos.where('key').anyOf(data.photos.map((p) => p.key)).keys())
  const photos = data.photos.filter((p) => {
    if (photoOwner.has(p.id) || knownKeys.has(p.key)) return false
    knownKeys.add(p.key)
    return true
  })
  const freshByStop = new Map<string, PhotoInfo[]>()
  for (const p of photos) freshByStop.set(p.stopId, [...(freshByStop.get(p.stopId) ?? []), p])
  // Tappe che mancano ma hanno già foto qui: un ripristino interrotto scrive
  // prima le foto e per ultime le tappe (vedi sotto). Rifacendolo, la tappa
  // nasce con le foto già arrivate.
  const arrived = new Set<string>()
  await db.photos.where('stopId').anyOf(data.stops.filter((s) => !localStops.has(s.id)).map((s) => s.id)).eachKey((id) => void arrived.add(id as string))

  const stops: Stop[] = []
  for (const s of data.stops) {
    const fresh = freshByStop.get(s.id)
    const cur = localStops.get(s.id)
    if (!cur) {
      const before = arrived.has(s.id) ? await db.photos.where('stopId').equals(s.id).toArray() : []
      if (before.length || fresh) stops.push({ ...s, ...stopSummary([...before, ...(fresh ?? [])]) })
      continue
    }
    if (!fresh) continue
    const summary = stopSummary([...(await db.photos.where('stopId').equals(s.id).toArray()), ...fresh])
    // Se la tappa ora comincia prima, il meteo va richiesto per la nuova ora.
    stops.push({ ...cur, ...summary, ...(summary.first !== cur.first ? { weather: undefined, weatherDone: undefined } : {}) })
  }
  // Foto la cui tappa non è nel file né sul telefono: non avrebbero dove stare.
  const placed = new Set([...stops.map((s) => s.id), ...localStops.keys()])
  const keptPhotos = photos.filter((p) => placed.has(p.stopId))

  const trips: Trip[] = []
  for (const t of data.trips) {
    const cur = localTrips.get(t.id)
    if (!cur) {
      trips.push({ ...t, coverImage: t.coverImage ? dataUrlToStored(t.coverImage) : undefined })
      continue
    }
    const diary = { ...t.diary, ...cur.diary }
    const nights = { ...t.nights, ...cur.nights }
    const more = Object.keys(diary).length > Object.keys(cur.diary ?? {}).length || Object.keys(nights).length > Object.keys(cur.nights ?? {}).length
    if (more) trips.push({ ...cur, diary, nights })
  }
  const routes = (data.routes ?? []).filter((r) => !routeOwner.has(r.id))

  // ⚠️ Notifiche dei viaggi seguiti (richiesta dell'utente, 30/10/2026):
  // l'iscrizione vale per UN telefono e UNA installazione dell'app. Ripristinata
  // altrove (telefono nuovo, app reinstallata) il menu direbbe «a ogni novità»
  // ma arriverebbero al vecchio indirizzo. Si tiene solo se è la stessa di
  // questo telefono; altrimenti risultano spente e si riattivano con un tocco.
  const mine = data.shares?.some((s) => s.notify) ? await currentPushSub() : undefined
  // Condivisioni: solo con la conferma, solo per viaggi che sul telefono non ci
  // sono ancora (il ripristino su un telefono nuovo), mai al posto di una che c'è.
  const already = new Set((await db.trips.bulkGet(data.trips.map((t) => t.id))).flatMap((t) => (t ? [t.id] : [])))
  const taken = new Set((await db.shares.toArray()).map((s) => s.tripId))
  const shares = (withShares && data.kind === 'backup' ? (data.shares ?? []) : [])
    .filter((s) => fileTrips.has(s.tripId) && !already.has(s.tripId) && !taken.has(s.tripId))
    .map((s) => (s.notify && s.notify.sub !== mine ? { ...s, notify: undefined } : s))
    // Il backup può essere più vecchio di quello che c'è sul server: il primo
    // invio controlla quali foto ci sono davvero (sync.ts, revisione D2).
    .map((s) => (s.role === 'owner' ? { ...s, recheck: true } : s))

  // Gli id sono quelli dell'esportazione: se l'app li ha già mostrati, gli
  // indirizzi in memoria puntano alle immagini di prima.
  forgetThumbs(trips.flatMap((t) => (!localTrips.has(t.id) && t.coverImageId ? [t.coverImageId] : [])))

  // Prima le foto, a gruppi, rileggendo il file: solo le miniature da
  // aggiungere passano dalla memoria, BATCH alla volta. Viaggi e tappe per
  // ultimi: se il ripristino si interrompe (iOS chiude l'app) restano solo foto
  // in più, che rifacendolo si ritrovano al loro posto (`arrived`).
  const waiting = new Set(keptPhotos.map((p) => p.id))
  let batch: Photo[] = []
  let written = 0
  const flush = async () => {
    forgetThumbs(batch.map((p) => p.id))
    await db.photos.bulkAdd(batch)
    written += batch.length
    batch = []
    onProgress?.(written, keptPhotos.length)
  }
  if (waiting.size) {
    onProgress?.(0, keptPhotos.length)
    await readFile(file, async (p) => {
      if (!waiting.delete(p.id)) return
      batch.push({ ...p, thumb: dataUrlToStored(p.thumb) })
      if (batch.length >= BATCH) await flush()
    })
    if (batch.length) await flush()
  }

  await db.transaction('rw', [db.trips, db.stops, db.routes, db.shares], async () => {
    await db.trips.bulkPut(trips)
    if (shares.length) await db.shares.bulkAdd(shares)
    if (data.kind === 'backup' && data.grouping) setGrouping(cleanGrouping(data.grouping))
    await db.stops.bulkPut(stops)
    await db.routes.bulkAdd(routes)
  })
  return {
    // Il nome di adesso, non quello del file (che può essere più vecchio).
    trips: data.trips.map((t) => localTrips.get(t.id)?.name ?? t.name),
    newTrips: data.trips.filter((t) => !localTrips.has(t.id)).length,
    photos: keptPhotos.length,
    present: data.photos.length - keptPhotos.length,
    filled: trips.filter((t) => localTrips.has(t.id)).length,
  }
}
