import type { Lodging, Stop } from './db'
import { dayOf } from './format'

/**
 * PERNOTTAMENTI (richiesta dell'utente, 1/11/2026)
 *
 * Dove si è dormito, sera per sera: `Trip.nights["2026-09-26"]` è l'alloggio
 * della notte fra il 26 e il 27. Più notti nello stesso posto hanno lo stesso
 * `Lodging.id`, così si riconoscono.
 *
 * Nell'itinerario l'alloggio diventa una TAPPA VIRTUALE a fine giornata
 * (`night:<giorno>`): la giornata finisce lì e quella dopo riparte da lì, con
 * i tratti e i percorsi stimati come fra due tappe vere (legs.ts, routing.ts).
 * Non è una scheda nell'archivio: le tappe restano solo quelle delle foto.
 */
export const NIGHT_PREFIX = 'night:'
export const nightId = (day: string) => NIGHT_PREFIX + day
export const isNight = (id: string) => id.startsWith(NIGHT_PREFIX)
export const nightDay = (id: string) => id.slice(NIGHT_PREFIX.length)

/** «2026-09-26» + n giorni, sul calendario. */
export function addDays(day: string, n: number): string {
  const d = new Date(Date.parse(day + 'T12:00:00Z') + n * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/** Il pezzo di tappa che serve all'itinerario (come `LegStop` in legs.ts). */
export type ItineraryStop = Pick<Stop, 'id' | 'lat' | 'lon' | 'start' | 'end' | 'transport' | 'straight'>

/**
 * Tappe e alloggi in ordine: per ogni giorno di calendario, le sue tappe e poi
 * l'alloggio di quella sera. Anche i giorni senza foto (un giorno fermi, un
 * cambio d'albergo) danno il loro alloggio. Due alloggi uguali di fila, senza
 * tappe in mezzo, contano una volta sola.
 */
export function itinerary(stops: ItineraryStop[], firstOf: (s: ItineraryStop) => string, nights: Record<string, Lodging> | undefined): ItineraryStop[] {
  if (!nights || Object.keys(nights).length === 0 || stops.length === 0) return stops
  const out: ItineraryStop[] = []
  const byDay = new Map<string, ItineraryStop[]>()
  for (const s of stops) {
    const d = dayOf(firstOf(s))
    byDay.set(d, [...(byDay.get(d) ?? []), s])
  }
  const firstDay = dayOf(firstOf(stops[0]))
  const lastDay = dayOf(firstOf(stops[stops.length - 1]))
  let lastNight: string | undefined
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const today = byDay.get(day) ?? []
    if (today.length) lastNight = undefined
    out.push(...today)
    const lodging = nights[day]
    if (!lodging || lodging.id === lastNight) continue
    // Ora della tappa virtuale: subito dopo l'ultima cosa del giorno, così
    // l'ordine resta giusto (gli avvisi sui tempi non valgono per questi tratti).
    const t = out.length ? out[out.length - 1].end : 0
    out.push({ id: nightId(day), lat: lodging.lat, lon: lodging.lon, start: t, end: t })
    lastNight = lodging.id
  }
  return out
}

/** Quante notti di fila, da `day` in poi, nello stesso alloggio. */
export function nightsInRow(nights: Record<string, Lodging> | undefined, day: string): number {
  const id = nights?.[day]?.id
  if (!id) return 0
  let n = 0
  while (nights?.[addDays(day, n)]?.id === id) n++
  return n
}

/** Posizione della notte nel suo soggiorno: «notte 2 di 3». */
export function nightOfStay(nights: Record<string, Lodging> | undefined, day: string): { n: number; of: number } {
  const id = nights?.[day]?.id
  if (!id) return { n: 0, of: 0 }
  let before = 0
  while (nights?.[addDays(day, -(before + 1))]?.id === id) before++
  return { n: before + 1, of: before + nightsInRow(nights, day) }
}
