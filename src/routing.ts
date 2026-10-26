import { db, type Route, type Stop } from './db'
import { legMode, profileOf, routeId, routeIsFresh } from './legs'

/**
 * Percorsi stimati fra le tappe, dal servizio pubblico Valhalla della comunità
 * OpenStreetMap (gratuito, senza chiave). Si calcolano in sottofondo, uno alla
 * volta, e si salvano: ogni tratto si chiede una volta sola per tipo di percorso.
 *
 * ⚠️ È un server della comunità, senza garanzie: si va piano (una richiesta
 * ogni PAUSE_MS) e, se non risponde, il tratto resta dritto e si riprova al
 * prossimo giro (avvio, ritorno della rete, modifica di un tratto). Rifiuta i
 * percorsi oltre 1500 km (errore 154): li salviamo come «far».
 */
const URL = 'https://valhalla1.openstreetmap.de/route'
const PAUSE_MS = 1200
/** Tolleranza della semplificazione dei punti, in gradi (~30 m). */
const SIMPLIFY = 0.0003

let running = false
let again = false
let first: string | undefined

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Decodifica la polilinea di Valhalla (precisione 6) in [lat, lon]. */
function decode(str: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0
  let lat = 0
  let lon = 0
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0
      let result = 0
      let b: number
      do {
        b = str.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    out.push([lat / 1e6, lon / 1e6])
  }
  return out
}

/** Douglas-Peucker: meno punti da salvare e da esportare, stessa forma a vista. */
function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ay, ax] = pts[a]
    const [by, bx] = pts[b]
    const len = Math.hypot(bx - ax, by - ay)
    let max = 0
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const [py, px] = pts[i]
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
      if (d > max) {
        max = d
        at = i
      }
    }
    if (max > SIMPLIFY) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i]).map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5])
}

type Outcome = Pick<Route, 'status' | 'coords' | 'km' | 'minutes' | 'ferry'> | 'retry'

async function ask(from: Stop, to: Stop, profile: string): Promise<Outcome> {
  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: profile,
    directions_options: { units: 'kilometers' },
  }
  let res: Response
  try {
    res = await fetch(`${URL}?json=${encodeURIComponent(JSON.stringify(body))}`)
  } catch {
    return 'retry'
  }
  if (res.status === 400) {
    const err = (await res.json().catch(() => ({}))) as { error_code?: number }
    return { status: err.error_code === 154 ? 'far' : 'none' }
  }
  if (!res.ok) return 'retry' // 429, 5xx: il servizio è occupato, si riprova più tardi
  const data = (await res.json()) as {
    trip?: { summary: { length: number; time: number; has_ferry?: boolean }; legs: { shape: string; maneuvers?: { type: number; travel_type?: string }[] }[] }
  }
  const trip = data.trip
  if (!trip?.legs?.[0]) return { status: 'none' }
  const ferry = !!trip.summary.has_ferry || !!trip.legs[0].maneuvers?.some((m) => m.type === 28 || m.travel_type === 'ferry')
  return { status: 'ok', coords: simplify(decode(trip.legs[0].shape)), km: trip.summary.length, minutes: trip.summary.time / 60, ferry }
}

/**
 * Calcola i percorsi che mancano o non valgono più. `tripId` passa davanti
 * agli altri viaggi (quello che si sta guardando).
 */
export async function routesPending(tripId?: string): Promise<void> {
  if (tripId) first = tripId
  if (!navigator.onLine) return
  if (running) {
    again = true
    return
  }
  running = true
  let complete = true
  try {
    const trips = (await db.trips.toArray()).sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0))
    outer: for (const trip of trips) {
      const stops = await db.stops.where('tripId').equals(trip.id).sortBy('start')
      for (let i = 1; i < stops.length; i++) {
        const [from, to] = [stops[i - 1], stops[i]]
        const profile = profileOf(legMode(from, to).mode)
        if (!profile) continue
        const id = routeId(to.id, profile)
        const saved = await db.routes.get(id)
        if (saved && routeIsFresh(saved, from, to)) continue
        const outcome = await ask(from, to, profile)
        if (outcome === 'retry') {
          complete = false
          break outer
        }
        await db.routes.put({ id, toStopId: to.id, tripId: trip.id, profile, fromLat: from.lat, fromLon: from.lon, toLat: to.lat, toLon: to.lon, at: Date.now(), ...outcome })
        await pause(PAUSE_MS)
      }
    }
  } finally {
    running = false
  }
  if (again && complete) {
    again = false
    await routesPending()
  }
}

window.addEventListener('online', () => void routesPending())
