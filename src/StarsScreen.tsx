import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, followedTripIds, stopTitle, type Photo, type Stop, type Trip } from './db'
import { fmtDay } from './format'
import { IconBack } from './icons'
import MapView, { type MapPin } from './MapView'
import { thumbUrl } from './thumbUrl'
import type { Route } from './App'

interface Row {
  stop: Stop
  trip: Trip
  cover?: Photo
}

/** Tutti i posti speciali (★) di tutti i viaggi, su una mappa e in un elenco. */
export default function StarsScreen({ go }: { go: (r: Route) => void }) {
  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const trips = new Map((await db.trips.toArray()).map((t) => [t.id, t]))
    const skip = await followedTripIds()
    const stars = (await db.stops.toArray()).filter((s) => s.star && !skip.has(s.tripId)).sort((a, b) => b.start - a.start)
    const out: Row[] = []
    for (const stop of stars) {
      const trip = trips.get(stop.tripId)
      if (!trip) continue
      const cover = (await db.photos.where('stopId').equals(stop.id).sortBy('time'))[0]
      out.push({ stop, trip, cover })
    }
    return out
  })

  const pins = useMemo<MapPin[]>(
    () => (rows ?? []).map((r) => ({ id: r.stop.id, lat: r.stop.lat, lon: r.stop.lon, color: r.trip.color, img: r.cover ? thumbUrl(r.cover) : undefined, star: true })),
    [rows],
  )
  const open = (r: Row) => go({ name: 'trip', id: r.trip.id, stop: r.stop.id })

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Posti speciali</h1>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty-state">
          <h2>Ancora nessuno</h2>
          <p>Apri una tappa e tocca la stellina ☆: i posti che segni compaiono qui, da tutti i viaggi.</p>
        </div>
      )}

      {pins.length > 0 && (
        <MapView
          pins={pins}
          lines={[]}
          fitKey={String(pins.length)}
          onPin={(id) => {
            const r = rows?.find((x) => x.stop.id === id)
            if (r) open(r)
          }}
        />
      )}

      <div style={{ marginTop: 12 }}>
        {rows?.map((r) => (
          <button key={r.stop.id} className="stop compact" onClick={() => open(r)}>
            {r.cover && <img className="thumb" src={thumbUrl(r.cover)} alt="" />}
            <span className="body">
              <span className="place" style={{ display: 'block' }}>
                <span className="star">★ </span>
                {stopTitle(r.stop)}
              </span>
              <span className="meta">
                <span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.trip.color, marginRight: 5 }} />
                {r.trip.name} · {fmtDay(r.stop.first)}
              </span>
              {r.stop.note && <span className="meta" style={{ display: 'block' }}>{r.stop.note}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
