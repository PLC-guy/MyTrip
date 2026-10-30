import { db, newId, stopSummary, toStored, type Photo, type Stop } from './db'
import { photoKey, readMeta } from './exif'
import { makeThumb, THUMB_MAX } from './thumb'
import { forgetThumbs } from './thumbUrl'

/**
 * Due foto appartengono alla stessa tappa se sono state scattate entro questa
 * distanza dal centro della tappa e entro questo tempo dai suoi estremi.
 * Valori di partenza: si regolano provando con viaggi veri.
 */
export const STOP_RADIUS_M = 150
export const STOP_GAP_MS = 60 * 60 * 1000

/** Foto lette prima di salvarle nell'archivio. */
const BATCH = 10

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportReport {
  added: number
  duplicates: number
  /** Già presenti con una miniatura più piccola, ora rifatta dall'originale (0.17.0). */
  improved: number
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
  const report: ImportReport = { added: 0, duplicates: 0, improved: 0, rejected: [] }
  let ready: Omit<Photo, 'stopId'>[] = []

  /**
   * Si salva a gruppi e non tutto alla fine: se iOS interrompe l'app a metà
   * (schermo spento, passaggio a un'altra app) le foto già lette restano, e
   * rifacendo l'import vengono riconosciute come «già presenti».
   */
  const flush = async () => {
    if (ready.length === 0) return
    await assignToStops(tripId, ready)
    report.added += ready.length
    ready = []
  }

  for (let i = 0; i < files.length; i++) {
    if (ready.length >= BATCH) await flush()
    const file = files[i]
    onProgress({ done: i, total: files.length })
    const result = await readMeta(file)
    if (!result.ok) {
      report.rejected.push({ name: file.name, reason: result.reason })
      continue
    }
    const key = photoKey(result.meta)
    const existing = await db.photos.where('key').equals(key).toArray()
    if (existing.length || ready.some((p) => p.key === key)) {
      report.duplicates++
      // Foto già importata con la miniatura piccola di prima della 0.17.0: si
      // rifà dall'originale appena scelto. Tutto il resto (tappa, locale) resta.
      const small = existing.filter((p) => Math.max(p.width || 0, p.height || 0) < THUMB_MAX)
      if (small.length) {
        try {
          const thumb = await makeThumb(file)
          if (Math.max(thumb.width, thumb.height) > Math.max(small[0].width || 0, small[0].height || 0)) {
            const bytes = await toStored(thumb.blob)
            await db.transaction('rw', db.photos, () => Promise.all(small.map((p) => db.photos.update(p.id, { thumb: bytes, width: thumb.width, height: thumb.height }))))
            forgetThumbs(small.map((p) => p.id))
            report.improved++
          }
        } catch {
          // Illeggibile: resta la miniatura di prima.
        }
      }
      continue
    }
    try {
      const thumb = await makeThumb(file)
      ready.push({ id: newId(), tripId, key, ...result.meta, thumb: await toStored(thumb.blob), width: thumb.width, height: thumb.height, name: file.name })
    } catch {
      report.rejected.push({ name: file.name, reason: 'illeggibile' })
    }
  }
  await flush()
  onProgress({ done: files.length, total: files.length })
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
