import { db, newId, stopSummary, type Photo, type Stop } from './db'
import { photoKey, readMeta } from './exif'
import { makeThumb } from './thumb'

/**
 * Due foto appartengono alla stessa tappa se sono state scattate entro questa
 * distanza dal centro della tappa e entro questo tempo dai suoi estremi.
 * Valori di partenza: si regolano provando con viaggi veri.
 */
export const STOP_RADIUS_M = 150
export const STOP_GAP_MS = 60 * 60 * 1000

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportReport {
  added: number
  duplicates: number
  rejected: { name: string; reason: string }[]
}

/** Distanza in metri fra due punti (formula dell'emisenoverso). */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Importa le foto scelte dentro un viaggio.
 *
 * Una foto alla volta: su iPhone decodificare in parallelo decine di foto da
 * 12 megapixel esaurisce la memoria della pagina.
 */
export async function importPhotos(
  tripId: string,
  files: File[],
  onProgress: (p: ImportProgress) => void,
): Promise<ImportReport> {
  const report: ImportReport = { added: 0, duplicates: 0, rejected: [] }
  const ready: Omit<Photo, 'stopId'>[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress({ done: i, total: files.length })
    const result = await readMeta(file)
    if (!result.ok) {
      report.rejected.push({ name: file.name, reason: result.reason })
      continue
    }
    const key = photoKey(result.meta)
    const exists = (await db.photos.where('key').equals(key).count()) > 0 || ready.some((p) => p.key === key)
    if (exists) {
      report.duplicates++
      continue
    }
    try {
      const thumb = await makeThumb(file)
      ready.push({ id: newId(), tripId, key, ...result.meta, thumb: thumb.blob, width: thumb.width, height: thumb.height, name: file.name })
    } catch {
      report.rejected.push({ name: file.name, reason: 'illeggibile' })
    }
  }
  onProgress({ done: files.length, total: files.length })

  if (ready.length > 0) {
    await assignToStops(tripId, ready)
    report.added = ready.length
  }
  return report
}

/** Mette ogni foto nuova in una tappa esistente vicina, o ne crea una. */
async function assignToStops(tripId: string, incoming: Omit<Photo, 'stopId'>[]): Promise<void> {
  await db.transaction('rw', db.stops, db.photos, async () => {
    const stops = await db.stops.where('tripId').equals(tripId).toArray()
    const members = new Map<string, Pick<Photo, 'lat' | 'lon' | 'time' | 'taken'>[]>()
    for (const s of stops) members.set(s.id, await db.photos.where('stopId').equals(s.id).toArray())
    const touched = new Set<string>()
    const photos: Photo[] = []

    for (const p of [...incoming].sort((a, b) => a.time - b.time)) {
      let target: Stop | undefined
      let best = Infinity
      for (const s of stops) {
        const gap = p.time < s.start ? s.start - p.time : p.time > s.end ? p.time - s.end : 0
        if (gap > STOP_GAP_MS) continue
        const d = distanceM(s.lat, s.lon, p.lat, p.lon)
        if (d <= STOP_RADIUS_M && d < best) {
          best = d
          target = s
        }
      }
      if (!target) {
        target = { id: newId(), tripId, lat: p.lat, lon: p.lon, start: p.time, end: p.time, first: p.taken }
        stops.push(target)
        members.set(target.id, [])
      }
      const list = members.get(target.id)!
      list.push(p)
      Object.assign(target, stopSummary(list))
      touched.add(target.id)
      photos.push({ ...p, stopId: target.id })
    }

    await db.stops.bulkPut(stops.filter((s) => touched.has(s.id)))
    await db.photos.bulkAdd(photos)
  })
}
