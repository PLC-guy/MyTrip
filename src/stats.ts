import { stopTitle, type Photo, type Stop } from './db'
import { dayOf, daySpan } from './format'
import { distanceM } from './importPhotos'
import type { LegInfo } from './legs'

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
  /** Km sui percorsi stimati (in linea d'aria dove il percorso non c'è). */
  routeKm: number
  /** Km per mezzo indicato da chi usa l'app. */
  byTransport: { icon: string; label: string; km: number }[]
  /** Km per mezzo dedotto dall'app: tenuti a parte, sono meno certi. */
  byInferred: { icon: string; label: string; km: number }[]
}

export function tripStats(stops: Stop[], photos: Photo[], legs: LegInfo[]): TripStats {
  let km = 0
  for (let i = 1; i < stops.length; i++) km += distanceM(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon) / 1000

  let routeKm = 0
  const chosen = new Map<string, { icon: string; label: string; km: number }>()
  const inferred = new Map<string, { icon: string; label: string; km: number }>()
  for (const l of legs) {
    routeKm += l.km
    const bucket = l.inferred ? inferred : chosen
    const row = bucket.get(l.label) ?? { icon: l.icon, label: l.label, km: 0 }
    row.km += l.km
    bucket.set(l.label, row)
  }
  const sortKm = (m: Map<string, { icon: string; label: string; km: number }>) => [...m.values()].sort((a, b) => b.km - a.km)

  const first = stops[0]?.first
  const last = stops.at(-1)?.first
  const days = first && last ? daySpan(first, last) : 0

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

  return { km, routeKm, days, stops: stops.length, photos: photos.length, countries, places, highest, busiest, byTransport: sortKm(chosen), byInferred: sortKm(inferred) }
}

const KM = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
export const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${KM.format(km)} km`)
