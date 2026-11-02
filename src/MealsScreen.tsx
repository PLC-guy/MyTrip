import { useMemo } from 'react'
import { useSessionState } from './sessionState'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, followedTripIds, stopTitle, type Meal, type Photo, type Stop, type Trip } from './db'
import { fmtDay, fmtDayShort, fmtTime, plural } from './format'
import { IconBack } from './icons'
import MapView, { type MapPin } from './MapView'
import { thumbUrl } from './thumbUrl'
import type { Route } from './App'
import { groupVenues, mealVenue, venueRating } from './venues'
import { useVenuePick, VenueVisits } from './VenueVisits'

/** Un locale: la visita più recente lo rappresenta (foto, tappa, viaggio). */
interface Row {
  stop: Stop & { meal: Meal }
  trip: Trip
  photo?: Photo
  /** Tutte le volte che ci si è mangiato, dalla più recente, in tutti i viaggi. */
  visits: { stop: Stop; trip: Trip }[]
  rating?: number
}

/** Filtro per voto: «Tutti» o almeno N stelle. */
const RATINGS = [0, 3, 4, 5]

/**
 * «Dove ho mangiato»: i locali di tutti i viaggi (tappe con `meal`), dal più
 * recente, su una mappa e in un elenco. Filtri per voto e per paese (richiesti
 * dall'utente, 28/10/2026). Ogni locale compare una volta sola, con un voto,
 * anche se ci si è stati più volte (venues.ts, richiesta del 2/11/2026).
 */
export default function MealsScreen({ go }: { go: (r: Route) => void }) {
  // Filtri ricordati finché l'app è aperta (sessionState.ts).
  const [minRating, setMinRating] = useSessionState('mytrip:meals-rating', 0, (v): v is number => RATINGS.includes(v as number))
  const [country, setCountry] = useSessionState('mytrip:meals-country', '')

  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const trips = new Map((await db.trips.toArray()).map((t) => [t.id, t]))
    const skip = await followedTripIds()
    const meals = (await db.stops.toArray())
      .filter((s): s is Stop & { meal: Meal } => !!s.meal && !skip.has(s.tripId) && trips.has(s.tripId))
      .sort((a, b) => b.start - a.start)
    const out: Row[] = []
    for (const visits of groupVenues(meals, mealVenue)) {
      const stop = visits[0]
      // La foto del piatto se c'è, altrimenti la prima della tappa.
      const photo = (stop.meal.photoId ? await db.photos.get(stop.meal.photoId) : undefined) ?? (await db.photos.where('stopId').equals(stop.id).sortBy('time'))[0]
      out.push({ stop, trip: trips.get(stop.tripId)!, photo, visits: visits.map((s) => ({ stop: s, trip: trips.get(s.tripId)! })), rating: venueRating(visits.map((s) => s.meal.rating)) })
    }
    return out
  })

  // Paesi presenti fra i locali, in ordine alfabetico.
  const countries = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows ?? []) if (r.stop.countryCode) map.set(r.stop.countryCode, r.stop.country ?? r.stop.countryCode)
    return [...map].sort((a, b) => a[1].localeCompare(b[1], 'it'))
  }, [rows])

  // Un paese scelto che non è più fra quelli dell'elenco (o col menu nascosto,
  // un paese solo) non filtra: altrimenti nasconderebbe tutto senza che si veda.
  const place = countries.length > 1 && countries.some(([c]) => c === country) ? country : ''
  const shown = useMemo(
    () => (rows ?? []).filter((r) => (r.rating ?? 0) >= minRating && (!place || r.stop.countryCode === place)),
    [rows, minRating, place],
  )
  const pins = useMemo<MapPin[]>(
    () =>
      shown.map((r) => ({
        id: r.stop.id,
        lat: r.stop.meal?.lat ?? r.stop.lat,
        lon: r.stop.meal?.lon ?? r.stop.lon,
        color: r.trip.color,
        img: r.photo ? thumbUrl(r.photo) : undefined,
        meal: true,
      })),
    [shown],
  )
  const [picked, pick] = useVenuePick()

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Dove ho mangiato</h1>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty-state">
          <h2>Ancora nessun locale</h2>
          <p>Apri una tappa e tocca 🍽️ sotto la foto del piatto: scegli il locale e dagli un voto. I posti dove hai mangiato compaiono qui, da tutti i viaggi.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Voto">
            {RATINGS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={minRating === n} className={minRating === n ? 'on' : ''} onClick={() => setMinRating(n)}>
                {n === 0 ? 'Tutti' : n === 5 ? '★5' : `★${n}+`}
              </button>
            ))}
          </div>
          {countries.length > 1 && (
            <select className="field meal-country" value={place} onChange={(e) => setCountry(e.target.value)} aria-label="Paese">
              <option value="">Tutti i paesi</option>
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {/* La chiave rifà l'inquadratura quando cambiano i filtri. Agganciata in
              alto: il locale scelto nell'elenco si vede centrato anche scorrendo. */}
          {pins.length > 0 && (
            <div className="venue-map">
              <MapView pins={pins} lines={[]} fitKey={`${minRating}|${place}|${pins.length}`} focusId={picked} onPin={(id) => pick(id, true)} />
            </div>
          )}

          <p className="meta" style={{ margin: '10px 2px' }}>
            {shown.length ? plural(shown.length, 'locale', 'locali') : 'Nessun locale con questi filtri'}
          </p>
          {shown.map((r) => {
            const meal = r.stop.meal
            return (
              <div key={r.stop.id} id={`venue-${r.stop.id}`} className={`venue${picked === r.stop.id ? ' on' : ''}`}>
              <button className="stop compact" aria-expanded={picked === r.stop.id} onClick={() => pick(r.stop.id)}>
                {r.photo && <img className="thumb" src={thumbUrl(r.photo)} alt="" />}
                <span className="body">
                  <span className="place" style={{ display: 'block' }}>
                    {meal.name}
                  </span>
                  <span className="meta" style={{ display: 'block' }}>
                    {meal.kind ? `${meal.kind} · ` : ''}
                    {r.rating ? <span className="meal-stars">{'★'.repeat(r.rating)}</span> : 'senza voto'}
                    {r.visits.length > 1 ? ` · ${r.visits.length} visite` : ''}
                  </span>
                  <span className="meta" style={{ display: 'block' }}>
                    <span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.trip.color, marginRight: 5 }} />
                    {stopTitle(r.stop)} · {r.trip.name} · {fmtDay(r.stop.first)}
                  </span>
                  {r.stop.note && <span className="meta" style={{ display: 'block' }}>{r.stop.note}</span>}
                </span>
              </button>
              {picked === r.stop.id && (
                <VenueVisits
                  one="Apri la tappa"
                  visits={r.visits.map((v) => ({ key: v.stop.id, label: `${v.trip.name} · ${fmtDayShort(v.stop.first)} · ${fmtTime(v.stop.first)}`, color: v.trip.color, open: () => go({ name: 'trip', id: v.trip.id, stop: v.stop.id }) }))}
                />
              )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
