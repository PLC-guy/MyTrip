// Versione «lite»: JPEG e HEIC con EXIF e GPS, cioè tutto ciò che serve, a una frazione del peso.
import exifr from 'exifr/dist/lite.esm.mjs'

export interface PhotoMeta {
  taken: string
  offset?: string
  time: number
  lat: number
  lon: number
}

export type MetaResult = { ok: true; meta: PhotoMeta } | { ok: false; reason: 'senza data' | 'senza posizione' | 'illeggibile' }

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Legge data e posizione dello scatto dai metadati EXIF.
 *
 * Regola dell'app: entrano SOLO foto con data e GPS. Quelle scattate dal
 * selettore («Scatta foto») o arrivate da altre app non li hanno e si scartano.
 *
 * ⚠️ L'ora EXIF è l'ora dell'orologio nel luogo dello scatto, senza fuso. exifr
 * la trasforma in una Date nel fuso di QUESTO dispositivo: rileggendola con i
 * getter locali si ottiene di nuovo l'ora originale, che è quella da mostrare
 * (una foto a Tokyo alle 18:00 deve dire 18:00 anche guardata da Bologna).
 */
export async function readMeta(file: Blob): Promise<MetaResult> {
  let raw: Record<string, unknown> | undefined
  try {
    // Niente `pick`: latitude/longitude sono calcolate da exifr a partire dai
    // tag GPS, e filtrare i tag rischierebbe di togliergli i dati di partenza.
    raw = await exifr.parse(file, { tiff: true, exif: true, gps: true })
  } catch {
    return { ok: false, reason: 'illeggibile' }
  }
  if (!raw) return { ok: false, reason: 'senza data' }

  const date = (raw.DateTimeOriginal ?? raw.CreateDate) as Date | undefined
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return { ok: false, reason: 'senza data' }

  const lat = raw.latitude
  const lon = raw.longitude
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon) || (lat === 0 && lon === 0)) {
    return { ok: false, reason: 'senza posizione' }
  }

  const taken = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const offsetRaw = (raw.OffsetTimeOriginal ?? raw.OffsetTime) as string | undefined
  const offset = typeof offsetRaw === 'string' && /^[+-]\d{2}:\d{2}$/.test(offsetRaw) ? offsetRaw : undefined
  const time = offset ? Date.parse(taken + offset) : Date.parse(taken + 'Z')

  return { ok: true, meta: { taken, offset, time, lat, lon } }
}

/** Impronta di uno scatto: stessa data e stessa posizione = stessa foto. */
export function photoKey(m: PhotoMeta): string {
  return `${m.taken}|${m.lat.toFixed(6)}|${m.lon.toFixed(6)}`
}
