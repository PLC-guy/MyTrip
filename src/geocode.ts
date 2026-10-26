import { db } from './db'

/**
 * Nome del luogo dalle coordinate, con il servizio gratuito di OpenStreetMap.
 *
 * ⚠️ Le regole d'uso di Nominatim chiedono al massimo una richiesta al secondo:
 * le tappe si chiedono in fila, una alla volta. Se manca la rete ci si ferma e
 * si riprova al prossimo avvio o al ritorno della connessione.
 */
const URL_BASE = 'https://nominatim.openstreetmap.org/reverse'
const PAUSE_MS = 1100

let running = false

interface NominatimReply {
  name?: string
  category?: string
  type?: string
  address?: Record<string, string>
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Categorie il cui nome proprio descrive davvero il posto (un museo, una spiaggia, un rifugio). */
const NICE_CATEGORIES = new Set(['tourism', 'historic', 'natural', 'leisure', 'place', 'waterway', 'mountain_pass'])
const NICE_AMENITIES = new Set(['place_of_worship', 'theatre', 'arts_centre', 'fountain', 'university', 'marketplace', 'monastery'])
/** Piazze e simili: il nome della «strada» è il nome del posto. */
const SQUARE = /^(piazza|piazzale|piazzetta|largo|campo|plaza|praça|place|square|platz|plein|rynek)\b/i

/**
 * «Piazza Maggiore, Bologna», «Spiaggia dei Conigli, Lampedusa», «Quadrilatero, Bologna».
 * Il nome di una banca o di un negozio davanti a cui si è scattato non dice
 * nulla del posto: si scarta.
 */
function pickPlace(reply: NominatimReply): { place?: string; country?: string } {
  const a = reply.address ?? {}
  const locality = a.village ?? a.town ?? a.city ?? a.municipality ?? a.hamlet ?? a.county ?? a.state
  const nice = reply.category && (NICE_CATEGORIES.has(reply.category) || (reply.category === 'amenity' && NICE_AMENITIES.has(reply.type ?? '')))
  let detail: string | undefined
  if (nice && reply.name) detail = reply.name
  else if (a.road && (SQUARE.test(a.road) || reply.type === 'pedestrian')) detail = a.road
  else detail = a.neighbourhood ?? a.quarter
  if (detail === locality) detail = undefined
  const place = [detail, locality].filter(Boolean).join(', ') || undefined
  return { place, country: a.country }
}

export async function geocodePending(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  try {
    const pending = (await db.stops.toArray()).filter((s) => !s.geocoded)
    for (const stop of pending) {
      const url = `${URL_BASE}?format=jsonv2&zoom=18&accept-language=it&lat=${stop.lat}&lon=${stop.lon}`
      let reply: NominatimReply
      try {
        const res = await fetch(url)
        if (!res.ok) break
        reply = (await res.json()) as NominatimReply
      } catch {
        break
      }
      await db.stops.update(stop.id, { ...pickPlace(reply), geocoded: true })
      await pause(PAUSE_MS)
    }
  } finally {
    running = false
  }
}

window.addEventListener('online', () => void geocodePending())
