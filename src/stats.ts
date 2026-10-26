import { stopTitle, type Photo, type Stop } from './db'
import { dayOf } from './format'
import { distanceM } from './importPhotos'
import { transportOf } from './transport'

export interface TripStats {
  /** Km in linea d'aria fra tappe consecutive. */
  km: number
  days: number
  stops: number
  photos: number
  countries: string[]
  places: number
  highest?: { alt: number; where: string }
  busiest?: { day: string; photos: number }
  /** Km per mezzo, solo per i tratti in cui il mezzo è stato indicato. */
  byTransport: { icon: string; label: string; km: number }[]
}

export function tripStats(stops: Stop[], photos: Photo[]): TripStats {
  let km = 0
  const perTransport = new Map<string, number>()
  for (let i = 1; i < stops.length; i++) {
    const d = distanceM(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon) / 1000
    km += d
    if (stops[i].transport) perTransport.set(stops[i].transport!, (perTransport.get(stops[i].transport!) ?? 0) + d)
  }

  const first = stops[0]?.first
  const last = stops.at(-1)?.first
  const days = first && last ? Math.round((Date.parse(dayOf(last)) - Date.parse(dayOf(first))) / 86_400_000) + 1 : 0

  const countries = [...new Set(stops.map((s) => s.country).filter((c): c is string => !!c))]
  // Località: l'ultima parte del nome automatico, «Piazza Maggiore, Bologna» → «Bologna».
  const places = new Set(stops.map((s) => s.place?.split(', ').at(-1)).filter(Boolean)).size

  let highest: TripStats['highest']
  for (const p of photos) {
    if (p.alt == null || (highest && p.alt <= highest.alt)) continue
    const stop = stops.find((s) => s.id === p.stopId)
    highest = { alt: p.alt, where: stop ? stopTitle(stop) : '' }
  }

  const perDay = new Map<string, number>()
  for (const p of photos) perDay.set(dayOf(p.taken), (perDay.get(dayOf(p.taken)) ?? 0) + 1)
  let busiest: TripStats['busiest']
  for (const [day, n] of perDay) if (!busiest || n > busiest.photos) busiest = { day, photos: n }

  const byTransport = [...perTransport]
    .map(([key, k]) => ({ icon: transportOf(key)?.icon ?? '•', label: transportOf(key)?.label ?? key, km: k }))
    .sort((a, b) => b.km - a.km)

  return { km, days, stops: stops.length, photos: photos.length, countries, places, highest, busiest, byTransport }
}

const KM = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
export const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${KM.format(km)} km`)
