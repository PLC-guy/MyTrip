import { db, type Photo, type Stop, type Trip } from './db'

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

interface ExportFile {
  app: typeof APP
  format: number
  kind: 'trip' | 'backup'
  exportedAt: string
  trips: Trip[]
  stops: Stop[]
  photos: PhotoFile[]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}

async function build(kind: ExportFile['kind'], trips: Trip[]): Promise<ExportFile> {
  const ids = trips.map((t) => t.id)
  const stops = await db.stops.where('tripId').anyOf(ids).toArray()
  const photos = await db.photos.where('tripId').anyOf(ids).toArray()
  const encoded: PhotoFile[] = []
  for (const p of photos) encoded.push({ ...p, thumb: await blobToDataUrl(p.thumb) })
  return { app: APP, format: FORMAT, kind, exportedAt: new Date().toISOString(), trips, stops, photos: encoded }
}

/** Nome di file sicuro su ogni sistema. */
function safeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'viaggio'
}

export async function exportTrip(tripId: string): Promise<File> {
  const trip = await db.trips.get(tripId)
  if (!trip) throw new Error('Viaggio non trovato')
  const data = await build('trip', [trip])
  return new File([JSON.stringify(data)], `${safeName(trip.name)}.mytrip.json`, { type: 'application/json' })
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
export async function deliverFile(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      // Annullato da chi usa l'app: non è un errore.
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
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

  const photos: Photo[] = []
  for (const p of data.photos) photos.push({ ...p, thumb: await dataUrlToBlob(p.thumb) })

  await db.transaction('rw', db.trips, db.stops, db.photos, async () => {
    await db.trips.bulkPut(data.trips)
    await db.stops.bulkPut(data.stops)
    await db.photos.bulkPut(photos)
  })
  return { trips: data.trips.map((t) => t.name), photos: photos.length }
}
