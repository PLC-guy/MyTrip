import type { Stop } from './db'
import type { MapLine } from './MapView'

/**
 * Mezzo usato per arrivare a una tappa dalla precedente. Lo sceglie chi usa
 * l'app: non si deduce. Gli spostamenti dentro una tappa non si registrano.
 *
 * ⚠️ Le `key` sono salvate dentro le tappe e nei file esportati: non si
 * rinominano. Per cambiare ciò che si legge basta `label`.
 */
export const TRANSPORTS = [
  { key: 'walk', label: 'A piedi', icon: '🚶' },
  { key: 'bike', label: 'Bici', icon: '🚲' },
  { key: 'scooter', label: 'Scooter', icon: '🛵' },
  { key: 'car', label: 'Auto', icon: '🚗' },
  { key: 'taxi', label: 'Taxi', icon: '🚕' },
  { key: 'bus', label: 'Bus', icon: '🚌' },
  { key: 'train', label: 'Treno', icon: '🚆' },
  { key: 'boat', label: 'Traghetto', icon: '⛴️' },
  { key: 'plane', label: 'Aereo', icon: '✈️' },
] as const

export type TransportKey = (typeof TRANSPORTS)[number]['key']

export const transportOf = (key?: string) => TRANSPORTS.find((t) => t.key === key)

/**
 * I tratti dell'itinerario per la mappa, uno per coppia di tappe, col mezzo.
 * `upTo` limita ai primi tratti (itinerario animato).
 */
export function legLines(stops: Pick<Stop, 'id' | 'lat' | 'lon' | 'transport'>[], color: string, upTo = stops.length): MapLine[] {
  const out: MapLine[] = []
  for (let i = 1; i < Math.min(upTo, stops.length); i++) {
    const t = transportOf(stops[i].transport)
    out.push({ id: stops[i].id, color, points: [[stops[i - 1].lat, stops[i - 1].lon], [stops[i].lat, stops[i].lon]], flight: t?.key === 'plane', icon: t?.icon })
  }
  return out
}
