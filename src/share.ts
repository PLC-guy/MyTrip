import type { Photo, Stop } from './db'
import { fmtDateTime } from './format'

const isApple = () => /iPhone|iPad|Macintosh/.test(navigator.userAgent)

export const googleMapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`

/**
 * Apre il luogo nell'app di mappe del dispositivo (Mappe su iPhone). Se alla
 * tappa c'è un locale, si cerca il locale per nome nella sua posizione: Mappe
 * mostra la sua scheda, con orari e recensioni.
 */
export function mapsUrl(stop: Stop): string {
  const lat = stop.meal?.lat ?? stop.lat
  const lon = stop.meal?.lon ?? stop.lon
  const name = stop.meal?.name ?? stop.place ?? 'Tappa'
  if (isApple()) return `https://maps.apple.com/?ll=${lat.toFixed(6)},${lon.toFixed(6)}&q=${encodeURIComponent(name)}`
  if (stop.meal) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat.toFixed(5)},${lon.toFixed(5)}`)}`
  return googleMapsUrl(lat, lon)
}

/** Condivide un posto: nome, data, link alla mappa e, se possibile, la foto. */
export async function shareStop(stop: Stop, photo?: Photo): Promise<'shared' | 'copied' | 'cancelled'> {
  const link = googleMapsUrl(stop.lat, stop.lon)
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
