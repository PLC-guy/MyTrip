import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, stopTitle, type Photo, type Stop, type Trip } from './db'
import { fmtDay, plural } from './format'
import { IconBack } from './icons'
import MapView, { type MapPin } from './MapView'
import { thumbUrl } from './thumbUrl'
import type { Route } from './App'

interface Row {
  stop: Stop
  trip: Trip
  photo?: Photo
}

/** Filtro per voto: «Tutti» o almeno N stelle. */
const RATINGS = [0, 3, 4, 5]

/**
 * «Dove ho mangiato»: i locali di tutti i viaggi (tappe con `meal`), dal più
 * recente, su una mappa e in un elenco. Filtri per voto e per paese (richiesti
 * dall'utente, 28/10/2026).
 */
export default function MealsScreen({ go }: { go: (r: Route) => void }) {
  const [minRating, setMinRating] = useState(0)
  const [country, setCountry] = useState('')

  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const trips = new Map((await db.trips.toArray()).map((t) => [t.id, t]))
    const meals = (await db.stops.toArray()).filter((s) => s.meal).sort((a, b) => b.start - a.start)
    const out: Row[] = []
    for (const stop of meals) {
      const trip = trips.get(stop.tripId)
      if (!trip) continue
      // La foto del piatto se c'è, altrimenti la prima della tappa.
      const photo = (stop.meal?.photoId ? await db.photos.get(stop.meal.photoId) : undefined) ?? (await db.photos.where('stopId').equals(stop.id).sortBy('time'))[0]
      out.push({ stop, trip, photo })
    }
    return out
  })

  // Paesi presenti fra i locali, in ordine alfabetico.
  const countries = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows ?? []) if (r.stop.countryCode) map.set(r.stop.countryCode, r.stop.country ?? r.stop.countryCode)
    return [...map].sort((a, b) => a[1].localeCompare(b[1], 'it'))
  }, [rows])

  const shown = useMemo(
    () => (rows ?? []).filter((r) => (r.stop.meal?.rating ?? 0) >= minRating && (!country || r.stop.countryCode === country)),
    [rows, minRating, country],
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
  const open = (r: Row) => go({ name: 'trip', id: r.trip.id, stop: r.stop.id })

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
            <select className="field meal-country" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Paese">
              <option value="">Tutti i paesi</option>
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {/* La chiave rifà l'inquadratura quando cambiano i filtri. */}
          {pins.length > 0 && (
            <MapView
              pins={pins}
              lines={[]}
              fitKey={`${minRating}|${country}|${pins.length}`}
              onPin={(id) => {
                const r = shown.find((x) => x.stop.id === id)
                if (r) open(r)
              }}
            />
          )}

          <p className="meta" style={{ margin: '10px 2px' }}>
            {shown.length ? plural(shown.length, 'locale', 'locali') : 'Nessun locale con questi filtri'}
          </p>
          {shown.map((r) => {
            const meal = r.stop.meal!
            return (
              <button key={r.stop.id} className="stop compact" onClick={() => open(r)}>
                {r.photo && <img className="thumb" src={thumbUrl(r.photo)} alt="" />}
                <span className="body">
                  <span className="place" style={{ display: 'block' }}>
                    {meal.name}
                  </span>
                  <span className="meta" style={{ display: 'block' }}>
                    {meal.kind ? `${meal.kind} · ` : ''}
                    {meal.rating ? <span className="meal-stars">{'★'.repeat(meal.rating)}</span> : 'senza voto'}
                  </span>
                  <span className="meta" style={{ display: 'block' }}>
                    <span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.trip.color, marginRight: 5 }} />
                    {stopTitle(r.stop)} · {r.trip.name} · {fmtDay(r.stop.first)}
                  </span>
                  {r.stop.note && <span className="meta" style={{ display: 'block' }}>{r.stop.note}</span>}
                </span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
