import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Lodging, type Trip } from './db'
import { fmtDay, plural } from './format'
import { IconBack } from './icons'
import MapView, { type MapPin } from './MapView'
import { addDays, nightId } from './nights'
import { groupVenues, ownNights, venueRating } from './venues'
import type { Route } from './App'

/** Un alloggio: la notte più recente lo rappresenta. */
interface Row {
  key: string
  lodging: Lodging
  trip: Trip
  /** Prima notte del soggiorno più recente: da qui si apre il pernottamento. */
  day: string
  nights: number
  rating?: number
  country?: string
  countryCode?: string
}

/** Filtro per voto: «Tutti» o almeno N stelle. */
const RATINGS = [0, 3, 4, 5]

/**
 * «Dove ho dormito»: gli alloggi di tutti i propri viaggi (pernottamenti,
 * nights.ts), uno per posto con il suo voto, su una mappa e in un elenco.
 * Filtri per voto e per paese, come «Dove ho mangiato» (richiesta dell'utente,
 * 2/11/2026). Il paese è quello dell'ultima tappa del giorno.
 */
export default function LodgingsScreen({ go }: { go: (r: Route) => void }) {
  const [minRating, setMinRating] = useState(0)
  const [country, setCountry] = useState('')

  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const nights = await ownNights()
    const stops = await db.stops.where('tripId').anyOf([...new Set(nights.map((n) => n.trip.id))]).toArray()
    return groupVenues(nights, (n) => n.lodging).map((g, i) => {
      const last = g[0]
      // Il soggiorno più recente comincia alla prima notte di fila nello stesso alloggio.
      let day = last.day
      while (g.some((n) => n.trip.id === last.trip.id && n.lodging.id === last.lodging.id && n.day === addDays(day, -1))) day = addDays(day, -1)
      const place = stops.filter((s) => s.tripId === last.trip.id && s.first.slice(0, 10) <= last.day).sort((a, b) => b.start - a.start)[0]
      return { key: `${i}|${last.lodging.id}`, lodging: last.lodging, trip: last.trip, day, nights: g.length, rating: venueRating(g.map((n) => n.lodging.rating)), country: place?.country, countryCode: place?.countryCode }
    })
  })

  const countries = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows ?? []) if (r.countryCode) map.set(r.countryCode, r.country ?? r.countryCode)
    return [...map].sort((a, b) => a[1].localeCompare(b[1], 'it'))
  }, [rows])

  const shown = useMemo(() => (rows ?? []).filter((r) => (r.rating ?? 0) >= minRating && (!country || r.countryCode === country)), [rows, minRating, country])
  const pins = useMemo<MapPin[]>(() => shown.map((r) => ({ id: r.key, lat: r.lodging.lat, lon: r.lodging.lon, color: r.trip.color })), [shown])
  const open = (r: Row) => go({ name: 'trip', id: r.trip.id, stop: nightId(r.day) })

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Dove ho dormito</h1>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty-state">
          <h2>Ancora nessun alloggio</h2>
          <p>In fondo a ogni giorno del viaggio tocca «🛏 Dove hai dormito?», scegli l'alloggio e dagli un voto. Gli alloggi compaiono qui, da tutti i viaggi.</p>
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

          {pins.length > 0 && (
            <MapView
              pins={pins}
              lines={[]}
              fitKey={`${minRating}|${country}|${pins.length}`}
              onPin={(id) => {
                const r = shown.find((x) => x.key === id)
                if (r) open(r)
              }}
            />
          )}

          <p className="meta" style={{ margin: '10px 2px' }}>
            {shown.length ? plural(shown.length, 'alloggio', 'alloggi') : 'Nessun alloggio con questi filtri'}
          </p>
          {shown.map((r) => (
            <button key={r.key} className="stop compact" onClick={() => open(r)}>
              <span className="thumb lodging-thumb" aria-hidden="true">🛏</span>
              <span className="body">
                <span className="place" style={{ display: 'block' }}>
                  {r.lodging.name}
                </span>
                <span className="meta" style={{ display: 'block' }}>
                  {r.lodging.kind ? `${r.lodging.kind} · ` : ''}
                  {r.rating ? <span className="meal-stars">{'★'.repeat(r.rating)}</span> : 'senza voto'}
                  {` · ${plural(r.nights, 'notte', 'notti')}`}
                </span>
                <span className="meta" style={{ display: 'block' }}>
                  <span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.trip.color, marginRight: 5 }} />
                  {r.trip.name} · {fmtDay(r.day + 'T12:00:00')}
                </span>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
