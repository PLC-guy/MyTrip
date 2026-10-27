import { db, type Photo, type Route, type Stop, type Trip } from './db'
import { forgetThumbs } from './thumbUrl'

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
function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',')
  const type = /^data:([^;,]+)/.exec(url)?.[1] ?? 'image/jpeg'
  const bin = atob(url.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

async function build(kind: ExportFile['kind'], trips: Trip[]): Promise<ExportFile> {
  const ids = trips.map((t) => t.id)
  const stops = await db.stops.where('tripId').anyOf(ids).toArray()
  const photos = await db.photos.where('tripId').anyOf(ids).toArray()
  const routes = await db.routes.where('tripId').anyOf(ids).toArray()
  const encoded: PhotoFile[] = []
  for (const p of photos) encoded.push({ ...p, thumb: await blobToDataUrl(p.thumb) })
  const tripFiles: TripFile[] = []
  for (const t of trips) tripFiles.push({ ...t, coverImage: t.coverImage ? await blobToDataUrl(t.coverImage) : undefined })
  return { app: APP, format: FORMAT, kind, exportedAt: new Date().toISOString(), trips: tripFiles, stops, photos: encoded, routes }
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
export async function exportTrips(tripIds: string[]): Promise<File> {
  const trips = (await db.trips.bulkGet(tripIds)).filter((t): t is Trip => !!t)
  if (trips.length === 0) throw new Error('Nessun viaggio scelto')
  const data = await build('trip', trips)
  const day = new Date().toISOString().slice(0, 10)
  const name = trips.length === 1 ? `${safeName(trips[0].name)}.mytrip.json` : `MyTrip-${trips.length}-viaggi-${day}.mytrip.json`
  return new File([JSON.stringify(data)], name, { type: 'application/json' })
}

export async function exportBackup(): Promise<File> {
  const data = await build('backup', await db.trips.toArray())
  const day = new Date().toISOString().slice(0, 10)
  return new File([JSON.stringify(data)], `MyTrip-backup-${day}.json`, { type: 'application/json' })
}

/**
 * Consegna il file: su iPhone col foglio di condivisione (Salva in File,
 * AirDrop, Messaggi…), altrove come download.
 */
/** Consegna il file; false se la condivisione è stata annullata (serve al promemoria di backup). */
export async function deliverFile(file: File): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return true
    } catch (e) {
      // Annullato da chi usa l'app: non è un errore.
      if (e instanceof DOMException && e.name === 'AbortError') return false
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
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
    data = JSON.parse(await file.text()) as ExportFile
  } catch {
    throw new Error('Il file non è leggibile.')
  }
  if (data?.app !== APP || !Array.isArray(data.trips) || !Array.isArray(data.stops) || !Array.isArray(data.photos)) {
    throw new Error('Questo non è un file di MyTrip.')
  }
  if (typeof data.format !== 'number' || data.format > FORMAT) {
    throw new Error("Il file viene da una versione più recente dell'app: aggiornala e riprova.")
  }

  const photos: Photo[] = data.photos.map((p) => ({ ...p, thumb: dataUrlToBlob(p.thumb) }))
  const trips: Trip[] = data.trips.map((t) => ({ ...t, coverImage: t.coverImage ? dataUrlToBlob(t.coverImage) : undefined }))

  // Gli id sono quelli dell'esportazione: se l'app li ha già mostrati, gli
  // indirizzi in memoria puntano alle immagini di prima.
  forgetThumbs([...photos.map((p) => p.id), ...trips.flatMap((t) => (t.coverImageId ? [t.coverImageId] : []))])

  await db.transaction('rw', [db.trips, db.stops, db.photos, db.routes], async () => {
    await db.trips.bulkPut(trips)
    await db.stops.bulkPut(data.stops)
    await db.photos.bulkPut(photos)
    if (Array.isArray(data.routes)) await db.routes.bulkPut(data.routes)
  })
  return { trips: data.trips.map((t) => t.name), photos: photos.length }
}
