import { db, followedTripIds, type Lodging, type Meal, type Stop, type Trip } from './db'
import { distanceM } from './importPhotos'

/**
 * LO STESSO POSTO IN PIÙ VISITE (richiesta dell'utente, 2/11/2026)
 *
 * Un locale o un alloggio visitato due volte compare una volta sola negli
 * elenchi («Dove ho mangiato», «Dove ho dormito») e ha un solo voto. Non c'è un
 * id del posto da OpenStreetMap: lo stesso posto = stesso nome (senza
 * maiuscole, accenti e punteggiatura) ed entro SAME_VENUE_M, anche in viaggi
 * diversi. Così due «McDonald's» di città diverse restano separati.
 * Il voto si scrive su ogni visita (`Meal.rating`, `Lodging.rating`): il formato
 * dei dati e degli export non cambia.
 * ⚠️ Solo i propri viaggi: quelli seguiti sono in sola lettura.
 */
export const SAME_VENUE_M = 200

export interface Venue {
  name: string
  lat: number
  lon: number
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const sameVenue = (a: Venue, b: Venue) => norm(a.name) === norm(b.name) && distanceM(a.lat, a.lon, b.lat, b.lon) <= SAME_VENUE_M

/** Dove sta il locale: la sua posizione, o quella della tappa se scritto a mano. */
export const mealVenue = (s: Stop & { meal: Meal }): Venue => ({ name: s.meal.name, lat: s.meal.lat ?? s.lat, lon: s.meal.lon ?? s.lon })

/**
 * Raggruppa le visite dello stesso posto, nell'ordine in cui arrivano (il
 * primo di ogni gruppo è la visita che lo rappresenta: si passa dal più recente).
 */
export function groupVenues<T>(items: T[], at: (t: T) => Venue): T[][] {
  const groups: T[][] = []
  for (const item of items) {
    const v = at(item)
    const g = groups.find((g) => sameVenue(at(g[0]), v))
    if (g) g.push(item)
    else groups.push([item])
  }
  return groups
}

/** Il voto di un posto: quello della visita più recente che ne ha uno. */
export const venueRating = (ratings: (number | undefined)[]) => ratings.find((r) => r != null)

async function ownMeals(): Promise<(Stop & { meal: Meal })[]> {
  const skip = await followedTripIds()
  return (await db.stops.toArray()).filter((s): s is Stop & { meal: Meal } => !!s.meal && !skip.has(s.tripId)).sort((a, b) => b.start - a.start)
}

/** Il voto già dato a questo locale in un'altra visita, se c'è. */
export async function knownMealRating(v: Venue): Promise<number | undefined> {
  return venueRating((await ownMeals()).filter((s) => sameVenue(mealVenue(s), v)).map((s) => s.meal.rating))
}

/** Dà (o toglie, con undefined) il voto a un locale: vale per tutte le sue visite. */
export async function rateMeal(v: Venue, rating: number | undefined): Promise<void> {
  const all = (await ownMeals()).filter((s) => sameVenue(mealVenue(s), v))
  await db.transaction('rw', db.stops, () => Promise.all(all.map((s) => db.stops.update(s.id, { meal: { ...s.meal, rating } }))))
}

/** Una notte in un alloggio, di un proprio viaggio. */
export interface Night {
  trip: Trip
  day: string
  lodging: Lodging
}

/** Tutte le notti dei propri viaggi, dalla più recente. */
export async function ownNights(): Promise<Night[]> {
  const skip = await followedTripIds()
  return (await db.trips.toArray())
    .filter((t) => !skip.has(t.id))
    .flatMap((trip) => Object.entries(trip.nights ?? {}).map(([day, lodging]) => ({ trip, day, lodging })))
    .sort((a, b) => b.day.localeCompare(a.day))
}

export async function knownLodgingRating(v: Venue): Promise<number | undefined> {
  return venueRating((await ownNights()).filter((n) => sameVenue(n.lodging, v)).map((n) => n.lodging.rating))
}

/** Dà (o toglie) il voto a un alloggio: vale per tutte le sue notti, in tutti i viaggi. */
export async function rateLodging(v: Venue, rating: number | undefined): Promise<void> {
  const nights = (await ownNights()).filter((n) => sameVenue(n.lodging, v))
  const trips = new Map<string, Trip>()
  for (const n of nights) {
    const t = trips.get(n.trip.id) ?? { ...n.trip, nights: { ...n.trip.nights } }
    t.nights![n.day] = { ...n.lodging, rating }
    trips.set(t.id, t)
  }
  await db.transaction('rw', db.trips, () => Promise.all([...trips.values()].map((t) => db.trips.update(t.id, { nights: t.nights }))))
}
