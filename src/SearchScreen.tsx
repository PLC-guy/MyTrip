import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, stopTitle, type Stop, type Trip } from './db'
import { fmtDay, fmtDayLong } from './format'
import { IconBack } from './icons'
import type { Route } from './App'

/** Confronto senza maiuscole né accenti: «citta» trova «Città». */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function SearchScreen({ go }: { go: (r: Route) => void }) {
  const [q, setQ] = useState('')
  const all = useLiveQuery(async () => ({ trips: await db.trips.toArray(), stops: await db.stops.orderBy('start').reverse().toArray() }))

  const results = useMemo(() => {
    const needle = norm(q.trim())
    if (!all || needle.length < 2) return undefined
    const tripById = new Map(all.trips.map((t) => [t.id, t]))
    const trips = all.trips.filter((t) => norm(t.name).includes(needle))
    const stops: { stop: Stop; trip: Trip; why?: string }[] = []
    for (const s of all.stops) {
      const trip = tripById.get(s.tripId)
      if (!trip) continue
      const inName = norm(stopTitle(s)).includes(needle) || norm(s.place ?? '').includes(needle) || norm(s.country ?? '').includes(needle)
      const inNote = !!s.note && norm(s.note).includes(needle)
      if (inName || inNote) stops.push({ stop: s, trip, why: inNote && !inName ? s.note : undefined })
    }
    const diary: { trip: Trip; day: string; text: string }[] = []
    for (const t of all.trips) for (const [day, text] of Object.entries(t.diary ?? {})) if (norm(text).includes(needle)) diary.push({ trip: t, day, text })
    return { trips, stops, diary }
  }, [q, all])

  const empty = results && results.trips.length + results.stops.length + results.diary.length === 0

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Cerca</h1>
      </div>
      <input className="field" type="search" autoFocus placeholder="Luogo, paese, nota, diario…" value={q} onChange={(e) => setQ(e.target.value)} />

      {empty && <p className="small" style={{ marginTop: 16 }}>Nessun risultato per «{q.trim()}».</p>}

      {results && results.trips.length > 0 && (
        <>
          <h2 className="section-title">Viaggi</h2>
          {results.trips.map((t) => (
            <button key={t.id} className="stop compact" onClick={() => go({ name: 'trip', id: t.id })}>
              <span className="body">
                <span className="place" style={{ display: 'block' }}>
                  <span className="dot" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: t.color, marginRight: 6 }} />
                  {t.name}
                </span>
              </span>
            </button>
          ))}
        </>
      )}

      {results && results.stops.length > 0 && (
        <>
          <h2 className="section-title">Tappe</h2>
          {results.stops.slice(0, 100).map(({ stop, trip, why }) => (
            <button key={stop.id} className="stop compact" onClick={() => go({ name: 'trip', id: trip.id, stop: stop.id })}>
              <span className="body">
                <span className="place" style={{ display: 'block' }}>
                  {stop.star && <span className="star">★ </span>}
                  {stopTitle(stop)}
                </span>
                <span className="meta" style={{ display: 'block' }}>
                  {trip.name} · {fmtDay(stop.first)}
                  {stop.country ? ` · ${stop.country}` : ''}
                </span>
                {why && <span className="meta" style={{ display: 'block' }}>«{why}»</span>}
              </span>
            </button>
          ))}
        </>
      )}

      {results && results.diary.length > 0 && (
        <>
          <h2 className="section-title">Diario</h2>
          {results.diary.map((d) => (
            <button key={d.trip.id + d.day} className="stop compact" onClick={() => go({ name: 'trip', id: d.trip.id })}>
              <span className="body">
                <span className="place" style={{ display: 'block' }}>
                  {d.trip.name} · {fmtDayLong(d.day + 'T12:00:00')}
                </span>
                <span className="meta" style={{ display: 'block' }}>{d.text.length > 140 ? d.text.slice(0, 140) + '…' : d.text}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
