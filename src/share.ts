import type { Photo, Stop } from './db'
import { fmtDateTime } from './format'

/**
 * Un posto da aprire nelle mappe. `search` = è un locale: si cerca per nome
 * (con l'indirizzo, se c'è), così le mappe mostrano la sua scheda con orari e
 * recensioni. Altrimenti si apre il punto esatto.
 */
export interface MapTarget {
  name: string
  lat: number
  lon: number
  address?: string
  search?: boolean
}

const coords = (t: MapTarget) => `${t.lat.toFixed(6)},${t.lon.toFixed(6)}`

/** Mappe di Apple: `ll` centra la ricerca sul posto, così trova il locale giusto anche se il nome è comune. */
export const appleMapsUrl = (t: MapTarget) => `https://maps.apple.com/?ll=${coords(t)}&q=${encodeURIComponent(t.name)}`

/**
 * Google Maps. ⚠️ Il link di Google non accetta un centro per la ricerca: per un
 * locale si cerca «nome, indirizzo» (o «nome, località»), per una tappa il
 * punto esatto.
 */
export const googleMapsUrl = (t: MapTarget) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.search ? [t.name, t.address].filter(Boolean).join(', ') : coords(t))}`

/** La tappa come destinazione: il locale, se c'è, altrimenti il punto della tappa. */
export function stopTarget(stop: Stop): MapTarget {
  if (stop.meal) {
    return { name: stop.meal.name, lat: stop.meal.lat ?? stop.lat, lon: stop.meal.lon ?? stop.lon, address: stop.meal.address ?? stop.place, search: true }
  }
  return { name: stop.name ?? stop.place ?? 'Tappa', lat: stop.lat, lon: stop.lon }
}

/** Condivide un posto: nome, data, link alla mappa e, se possibile, la foto. */
export async function shareStop(stop: Stop, photo?: Photo): Promise<'shared' | 'copied' | 'cancelled'> {
  const link = googleMapsUrl({ name: '', lat: stop.lat, lon: stop.lon })
  const text = [stop.meal?.name ?? stop.place ?? 'Un posto del mio viaggio', fmtDateTime(stop.first)].join(' · ')
  const files = photo ? [new File([photo.thumb], `${(stop.place ?? 'tappa').replace(/[^\w-]+/g, '-')}.jpg`, { type: 'image/jpeg' })] : []

  if (navigator.share) {
    try {
      if (files.length && navigator.canShare?.({ files })) await navigator.share({ files, text: `${text}\n${link}` })
      else await navigator.share({ text, url: link })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(`${text}\n${link}`)
  return 'copied'
}
