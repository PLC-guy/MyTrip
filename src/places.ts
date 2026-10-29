import type { Meal } from './db'
import { distanceM } from './importPhotos'

/**
 * LOCALI VICINI A UNA TAPPA («Ho mangiato qui»)
 *
 * Dati di OpenStreetMap, gratuiti e senza chiave: ristoranti, bar, pizzerie…
 * con un nome, entro RADII[0] dalla foto; «Cerca più lontano» passa a RADII[1].
 * ⚠️ Raggio largo ed elenco lungo (fino a MAX), dal più vicino: in una zona
 * turistica i locali sono tanti e vicini, e col GPS impreciso quello giusto può
 * essere il decimo (nella 0.11 di prova c'erano solo 60 m: 4 locali, osservazione
 * dell'utente del 28/10/2026). Si chiede SOLO quando l'utente tocca 🍽️.
 *
 * Due servizi, il secondo di riserva:
 * - Photon (komoot), ricerca all'indietro filtrata per tipo: risponde in meno
 *   di un secondo;
 * - Overpass, che conosce anche la cucina (pizzeria, sushi…). ⚠️ Provato il
 *   28/10/2026: con il server carico rispondeva «429 troppe richieste» o dopo
 *   oltre 20 s, e rifiuta le richieste POST senza intestazioni da browser.
 *   Per questo è solo di riserva, in GET, con un tempo massimo.
 * ⚠️ Il GPS al chiuso sbaglia anche di decine di metri: il locale lo sceglie
 * l'utente dall'elenco, oppure lo scrive a mano se OpenStreetMap non lo conosce.
 */
const PHOTON = 'https://photon.komoot.io/reverse'
const OVERPASS = 'https://overpass-api.de/api/interpreter'
/** Raggi di ricerca, in metri: il primo all'apertura, il secondo con «Cerca più lontano». */
export const RADII = [150, 400] as const
/** Locali mostrati al massimo. */
const MAX = 100
/** ⚠️ Photon ne restituisce al massimo 50 per richiesta, anche chiedendone di più. */
const PHOTON_LIMIT = 50
const PHOTON_MS = 8000
const OVERPASS_MS = 15000

const AMENITY: Record<string, string> = {
  restaurant: 'Ristorante',
  cafe: 'Bar · caffè',
  bar: 'Bar',
  pub: 'Pub',
  fast_food: 'Fast food',
  ice_cream: 'Gelateria',
  food_court: 'Area ristoro',
  biergarten: 'Birreria',
}

export interface NearbyPlace extends Meal {
  /** Distanza dalla foto, in metri. */
  distance: number
}

/** fetch con un tempo massimo: un servizio che non risponde non deve lasciare l'elenco in attesa per sempre. */
async function fetchJson<T>(url: string, ms: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** «Via Rizzoli 1, Bologna», con le parti che ci sono. */
function address(street?: string, number?: string, city?: string): string | undefined {
  const line = [street, number].filter(Boolean).join(' ')
  return [line, city].filter(Boolean).join(', ') || undefined
}

function finish(list: NearbyPlace[]): NearbyPlace[] {
  // Lo stesso locale può arrivare due volte (punto ed edificio, o da due
  // richieste): stesso nome a meno di ~100 m = stesso locale, conta il più vicino.
  const seen = new Set<string>()
  return list
    .sort((a, b) => a.distance - b.distance)
    .filter((p) => {
      const key = `${p.name}|${p.lat?.toFixed(3)}|${p.lon?.toFixed(3)}`
      return !seen.has(key) && seen.add(key)
    })
    .slice(0, MAX)
}

interface PhotonResult {
  features?: {
    geometry: { coordinates: [number, number] }
    properties: { name?: string; osm_value?: string; street?: string; housenumber?: string; city?: string; locality?: string }
  }[]
}

/** Una richiesta a Photon attorno a (qLat, qLon); le distanze si misurano dalla foto (lat, lon). */
async function photonAt(lat: number, lon: number, qLat: number, qLon: number, radius: number, qRadius: number): Promise<NearbyPlace[]> {
  const tags = Object.keys(AMENITY)
    .map((t) => `&osm_tag=amenity:${t}`)
    .join('')
  // ⚠️ lang=en: con "default" i nomi arrivano nella lingua del posto (a Bangkok in
  // caratteri thai) e molti locali senza nome; l'italiano Photon non lo supporta.
  const json = await fetchJson<PhotonResult>(`${PHOTON}?lat=${qLat}&lon=${qLon}&radius=${qRadius / 1000}&limit=${PHOTON_LIMIT}&lang=en${tags}`, PHOTON_MS)
  const out: NearbyPlace[] = []
  for (const f of json.features ?? []) {
    const [pLon, pLat] = f.geometry.coordinates
    const name = f.properties.name
    if (!name) continue
    const distance = Math.round(distanceM(lat, lon, pLat, pLon))
    if (distance > radius) continue
    const pr = f.properties
    out.push({ name, kind: AMENITY[pr.osm_value ?? ''], lat: pLat, lon: pLon, distance, address: address(pr.street, pr.housenumber, pr.city ?? pr.locality) })
  }
  return out
}

/**
 * Entro il raggio stretto basta una richiesta. Per quello largo una sola
 * richiesta si fermerebbe ai 50 locali più vicini (in centro a Bologna: entro
 * ~170 m invece di 400): se ne fanno cinque, dalla foto e da quattro punti
 * attorno, e si uniscono (circa un secondo in tutto).
 */
async function photon(lat: number, lon: number, radius: number): Promise<NearbyPlace[]> {
  if (radius <= RADII[0]) return finish(await photonAt(lat, lon, lat, lon, radius, radius))
  const d = radius * 0.55
  const dLat = d / 111_320
  const dLon = d / (111_320 * Math.cos((lat * Math.PI) / 180))
  const centers: [number, number][] = [
    [lat, lon],
    [lat + dLat, lon],
    [lat - dLat, lon],
    [lat, lon + dLon],
    [lat, lon - dLon],
  ]
  // Una alla volta: in parallelo Photon le rifiuta (prova del 28/10/2026). Se ne
  // fallisce qualcuna si tengono le altre; se falliscono tutte, errore.
  const all: NearbyPlace[] = []
  let ok = 0
  for (const [qLat, qLon] of centers) {
    try {
      all.push(...(await photonAt(lat, lon, qLat, qLon, radius, radius * 0.6)))
      ok++
    } catch {
      // si prova il punto successivo
    }
  }
  if (ok === 0) throw new Error('Photon non risponde')
  return finish(all)
}

interface OsmElement {
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** Tipo leggibile: la cucina, quando dice di più del tipo di locale. */
function kindOf(tags: Record<string, string>): string | undefined {
  const cuisine = tags.cuisine ?? ''
  if (/pizza/.test(cuisine)) return 'Pizzeria'
  if (/sushi/.test(cuisine)) return 'Sushi'
  return AMENITY[tags.amenity ?? '']
}

async function overpass(lat: number, lon: number, radius: number): Promise<NearbyPlace[]> {
  const types = Object.keys(AMENITY).join('|')
  const query = `[out:json][timeout:10];nwr(around:${radius},${lat},${lon})["amenity"~"^(${types})$"]["name"];out center ${MAX};`
  const json = await fetchJson<{ elements?: OsmElement[] }>(`${OVERPASS}?data=${encodeURIComponent(query)}`, OVERPASS_MS)
  const out: NearbyPlace[] = []
  for (const el of json.elements ?? []) {
    const p = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : undefined)
    const tags = el.tags ?? {}
    // Nome in italiano o in caratteri latini se c'è, come per le tappe.
    const name = tags['name:it'] ?? tags['name:latin'] ?? tags['name:en'] ?? tags.name
    if (!p || !name) continue
    out.push({ name, kind: kindOf(tags), lat: p.lat, lon: p.lon, distance: Math.round(distanceM(lat, lon, p.lat, p.lon)), address: address(tags['addr:street'], tags['addr:housenumber'], tags['addr:city']) })
  }
  return finish(out)
}

async function around(lat: number, lon: number, radius: number): Promise<NearbyPlace[]> {
  try {
    return await photon(lat, lon, radius)
  } catch {
    return overpass(lat, lon, radius)
  }
}

/**
 * Locali entro `radius` metri, dal più vicino. Lancia un errore senza rete o
 * se nessun servizio risponde.
 */
export async function nearbyPlaces(lat: number, lon: number, radius: number = RADII[0]): Promise<NearbyPlace[]> {
  return around(lat, lon, radius)
}
