import { asStored, db, toStored, type Photo, type Route, type Share, type Stop, type Trip } from './db'
import { forgetThumbs } from './thumbUrl'
import type { Progress } from './exportFlow'
import { shareThumb } from './shareThumb'

/**
 * File di export: un viaggio singolo o il backup di tutti.
 *
 * ⚠️ Il formato resta `1`: campi nuovi sì, ma facoltativi in lettura. Un file
 * esportato oggi deve entrare anche fra un anno, e anche nell'app di un'altra
 * persona (es. sul suo computer).
 */
const APP = 'mytrip'
const FORMAT = 1

type PhotoFile = Omit<Photo, 'thumb'> & { thumb: string }
/** `coverImage` facoltativo: i file esportati prima della 0.2.0 non lo hanno. */
type TripFile = Omit<Trip, 'coverImage'> & { coverImage?: string }

interface ExportFile {
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
function dataUrlToStored(url: string): Blob {
  const comma = url.indexOf(',')
  const bin = atob(url.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return asStored(bytes)
}

/** Foto convertite insieme: abbastanza per andare veloci, non tante da riempire la memoria. */
const PARALLEL = 8

/**
 * Costruisce il file. ⚠️ Non più un unico JSON.stringify: con viaggi grandi
 * (centinaia di foto, ~135 KB l'una nel file) era una stringa enorme in memoria,
 * lenta da creare. Ora ogni foto diventa un pezzo a sé e il file si compone dai
 * pezzi; le miniature si convertono PARALLEL alla volta, con l'avanzamento.
 * Il contenuto è identico a prima: formato 1, si reimporta allo stesso modo.
 */
async function build(kind: ExportFile['kind'], trips: Trip[], name: string, onProgress?: Progress, lite = false): Promise<File> {
  const ids = trips.map((t) => t.id)
  const stops = await db.stops.where('tripId').anyOf(ids).toArray()
  const photos = await db.photos.where('tripId').anyOf(ids).toArray()
  const routes = await db.routes.where('tripId').anyOf(ids).toArray()
  const shares = kind === 'backup' ? await db.shares.where('tripId').anyOf(ids).toArray() : []
  const tripFiles: TripFile[] = []
  for (const t of trips) tripFiles.push({ ...t, coverImage: t.coverImage ? await blobToDataUrl(t.coverImage) : undefined })

  const parts: string[] = []
  onProgress?.(0, photos.length)
  for (let i = 0; i < photos.length; i += PARALLEL) {
    const chunk = await Promise.all(
      photos.slice(i, i + PARALLEL).map(async (p) => JSON.stringify({ ...p, thumb: await blobToDataUrl(lite ? await shareThumb(p.thumb) : p.thumb) } satisfies PhotoFile)),
    )
    parts.push(...chunk)
    onProgress?.(Math.min(i + PARALLEL, photos.length), photos.length)
  }

  const head: Omit<ExportFile, 'photos'> = { app: APP, format: FORMAT, kind, exportedAt: new Date().toISOString(), trips: tripFiles, stops, routes, ...(lite ? { lite } : {}), ...(shares.length ? { shares } : {}) }
  const json = JSON.stringify(head)
  const pieces: BlobPart[] = [json.slice(0, -1), ',"photos":[']
  parts.forEach((p, i) => pieces.push(i ? ',' : '', p))
  pieces.push(']}')
  return new File(pieces, name, { type: 'application/json' })
}

/**
 * FILE COMPRESSO (30/10/2026, scelta dell'utente per mandarli più in fretta):
 * il contenuto è lo stesso JSON di sempre (formato 1), compresso con gzip dal
 * browser. Estensione `.mytrip`: non è un file da aprire a mano, si reimporta in
 * MyTrip (anche sul computer). Senza CompressionStream (browser vecchi) resta il
 * JSON in chiaro, `.mytrip.json`, e l'import li legge tutti e due.
 */
async function pack(json: File, base: string): Promise<File> {
  if (typeof CompressionStream === 'undefined') return new File([json], `${base}.mytrip.json`, { type: 'application/json' })
  const gz = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob()
  return new File([gz], `${base}.mytrip`, { type: 'application/octet-stream' })
}

/** Legge un file di MyTrip, compresso o in chiaro (riconosce gzip dai primi due byte). */
async function unpack(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (head[0] !== 0x1f || head[1] !== 0x8b) return file.text()
  return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

/** Nome di file sicuro su ogni sistema. */
function safeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'viaggio'
}

/**
 * Uno o più viaggi scelti (Impostazioni › Backup e ripristino). Un solo viaggio
 * prende il suo nome; più viaggi stanno in un unico file, che si reimporta allo
 * stesso modo. Non conta come backup completo: per quello c'è `exportBackup`.
 */
export async function exportTrips(tripIds: string[], onProgress?: Progress): Promise<File> {
  const trips = (await db.trips.bulkGet(tripIds)).filter((t): t is Trip => !!t)
  if (trips.length === 0) throw new Error('Nessun viaggio scelto')
  const day = new Date().toISOString().slice(0, 10)
  const base = trips.length === 1 ? safeName(trips[0].name) : `MyTrip-${trips.length}-viaggi-${day}`
  // Da mandare ad altri: miniature ridotte (shareThumb.ts). Il backup completo no.
  return pack(await build('trip', trips, 'export.json', onProgress, true), base)
}

export async function exportBackup(onProgress?: Progress): Promise<File> {
  const day = new Date().toISOString().slice(0, 10)
  return pack(await build('backup', await db.trips.toArray(), 'backup.json', onProgress), `MyTrip-backup-${day}`)
}


export interface ImportSummary {
  trips: string[]
  photos: number
}

/**
 * Importa un viaggio o un backup. Gli id sono gli stessi dell'esportazione:
 * ciò che esiste già si aggiorna, il resto si aggiunge. Niente si cancella.
 */
export async function importFile(file: File): Promise<ImportSummary> {
  let data: ExportFile
  try {
    data = JSON.parse(await unpack(file)) as ExportFile
  } catch {
    throw new Error('Il file non è leggibile.')
  }
  if (data?.app !== APP || !Array.isArray(data.trips) || !Array.isArray(data.stops) || !Array.isArray(data.photos)) {
    throw new Error('Questo non è un file di MyTrip.')
  }
  if (typeof data.format !== 'number' || data.format > FORMAT) {
    throw new Error("Il file viene da una versione più recente dell'app: aggiornala e riprova.")
  }

  const photos: Photo[] = data.photos.map((p) => ({ ...p, thumb: dataUrlToStored(p.thumb) }))
  // ⚠️ Un file da condividere ha miniature ridotte: se quelle foto ci sono già
  // (per esempio un viaggio che torna indietro da chi l'ha ricevuto), si tengono
  // le miniature di qui, più nitide. Tutto il resto si aggiorna come sempre.
  if (data.lite) {
    const existing = await db.photos.bulkGet(photos.map((p) => p.id))
    await Promise.all(
      photos.map(async (p, i) => {
        const old = existing[i]
        if (old) p.thumb = await toStored(old.thumb)
      }),
    )
  }
  const trips: Trip[] = data.trips.map((t) => ({ ...t, coverImage: t.coverImage ? dataUrlToStored(t.coverImage) : undefined }))

  // Gli id sono quelli dell'esportazione: se l'app li ha già mostrati, gli
  // indirizzi in memoria puntano alle immagini di prima.
  forgetThumbs([...photos.map((p) => p.id), ...trips.flatMap((t) => (t.coverImageId ? [t.coverImageId] : []))])

  await db.transaction('rw', [db.trips, db.stops, db.photos, db.routes, db.shares], async () => {
    await db.trips.bulkPut(trips)
    if (data.kind === 'backup' && Array.isArray(data.shares)) await db.shares.bulkPut(data.shares)
    await db.stops.bulkPut(data.stops)
    await db.photos.bulkPut(photos)
    if (Array.isArray(data.routes)) await db.routes.bulkPut(data.routes)
  })
  return { trips: data.trips.map((t) => t.name), photos: photos.length }
}
