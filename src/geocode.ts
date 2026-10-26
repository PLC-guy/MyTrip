import { db, type Stop } from './db'

/**
 * Nome del luogo dalle coordinate, con il servizio gratuito di OpenStreetMap.
 *
 * ⚠️ Le regole d'uso di Nominatim chiedono al massimo una richiesta al secondo:
 * le tappe si chiedono in fila, una alla volta. Se manca la rete ci si ferma e
 * si riprova al prossimo avvio o al ritorno della connessione.
 */
const URL_BASE = 'https://nominatim.openstreetmap.org/reverse'
const PAUSE_MS = 1100

/**
 * Lingue in ordine di preferenza. ⚠️ L'inglese come ripiego serve: dove manca il
 * nome italiano Nominatim darebbe quello locale, che in Thailandia è in thai.
 */
const LANGS = 'it,en'

/**
 * Versione della ricerca dei nomi. Le tappe chiamate con una versione
 * precedente e rimaste con un nome in alfabeto non latino si richiedono una
 * volta sola con le regole nuove.
 */
const GEO_VERSION = 3 // 3: si salva anche il codice del paese (mappa dei paesi visitati)
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

let running = false
let again = false

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
function pickPlace(reply: NominatimReply): { place?: string; country?: string; countryCode?: string } {
  const a = reply.address ?? {}
  const locality = a.village ?? a.town ?? a.city ?? a.municipality ?? a.hamlet ?? a.county ?? a.state
  const nice = reply.category && (NICE_CATEGORIES.has(reply.category) || (reply.category === 'amenity' && NICE_AMENITIES.has(reply.type ?? '')))
  let detail: string | undefined
  if (nice && reply.name) detail = reply.name
  else if (a.road && (SQUARE.test(a.road) || reply.type === 'pedestrian')) detail = a.road
  else detail = a.neighbourhood ?? a.quarter
  if (detail === locality) detail = undefined
  const parts = [detail, locality].filter((p): p is string => !!p)
  // Una parte in alfabeto non latino (un tempio senza nome inglese) si lascia
  // fuori se ne resta un'altra leggibile; se sono tutte così, meglio di niente.
  const readable = parts.filter((p) => !NON_LATIN.test(p))
  const place = (readable.length ? readable : parts).join(', ') || undefined
  return { place, country: a.country, countryCode: a.country_code?.toUpperCase() }
}

/** Ogni tappa chiesta con regole più vecchie si richiede una volta. */
const needsName = (s: Stop) => !s.geocoded || s.geoV !== GEO_VERSION

/**
 * Cosa aggiornare. Il nome del luogo si sostituisce solo se manca o è in un
 * alfabeto non latino: una tappa già con un buon nome riceve solo il paese.
 * Il nome scelto a mano (`name`) non si tocca mai: è un campo a parte.
 */
function patchFor(stop: Stop, found: ReturnType<typeof pickPlace>): Partial<Stop> {
  const patch: Partial<Stop> = { country: found.country, countryCode: found.countryCode, geocoded: true, geoV: GEO_VERSION }
  if (!stop.geocoded || !stop.place || NON_LATIN.test(stop.place)) patch.place = found.place
  return patch
}

export async function geocodePending(): Promise<void> {
  if (!navigator.onLine) return
  // Chiamata mentre la fila è già in corso (es. una tappa appena divisa): si
  // annota, e a fine giro si ricontrolla invece di perderla.
  if (running) {
    again = true
    return
  }
  running = true
  let complete = true
  try {
    const pending = (await db.stops.toArray()).filter(needsName)
    for (const stop of pending) {
      const url = `${URL_BASE}?format=jsonv2&zoom=18&accept-language=${LANGS}&lat=${stop.lat}&lon=${stop.lon}`
      let reply: NominatimReply
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        reply = (await res.json()) as NominatimReply
      } catch {
        complete = false
        break
      }
      await db.stops.update(stop.id, patchFor(stop, pickPlace(reply)))
      await pause(PAUSE_MS)
    }
  } finally {
    running = false
  }
  if (again && complete) {
    again = false
    await geocodePending()
  }
}

window.addEventListener('online', () => void geocodePending())
