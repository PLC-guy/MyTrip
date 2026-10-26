import { useMemo, useState } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, TRIP_COLORS, type Stop, type Trip } from './db'
import { fmtRange, plural } from './format'
import { IconGear, IconPhotos, IconPlus } from './icons'
import MapView, { type MapLine, type MapPin } from './MapView'
import Sheet from './Sheet'
import { thumbUrl } from './thumbUrl'
import type { Route } from './App'

interface TripRow {
  trip: Trip
  stops: Stop[]
  cover?: { id: string; thumb: Blob }
  photos: number
}

/** iPhone fuori dall'app installata: i dati del browser sono un archivio a parte. */
const inSafariTab = /iPhone|iPad/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone

export default function HomeScreen({ go }: { go: (r: Route) => void }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const rows = useLiveQuery(async (): Promise<TripRow[]> => {
    const trips = await db.trips.toArray()
    const stops = await db.stops.orderBy('start').toArray()
    const out: TripRow[] = []
    for (const trip of trips) {
      // Copertina: immagine caricata apposta, poi foto scelta, poi la prima del viaggio.
      const cover: TripRow['cover'] =
        trip.coverImage && trip.coverImageId
          ? { id: trip.coverImageId, thumb: trip.coverImage }
          : ((trip.coverPhotoId ? await db.photos.get(trip.coverPhotoId) : undefined) ??
            (await db.photos.where('[tripId+time]').between([trip.id, Dexie.minKey], [trip.id, Dexie.maxKey]).first()))
      const photos = await db.photos.where('tripId').equals(trip.id).count()
      out.push({ trip, stops: stops.filter((s) => s.tripId === trip.id), cover, photos })
    }
    // Il più recente in alto; i viaggi appena creati e ancora vuoti sopra tutti.
    const when = (r: TripRow) => (r.stops.length ? r.stops[r.stops.length - 1].end : Number.MAX_SAFE_INTEGER - (Date.now() - r.trip.createdAt))
    return out.sort((a, b) => when(b) - when(a))
  })

  const { pins, lines } = useMemo(() => {
    const pins: MapPin[] = []
    const lines: MapLine[] = []
    for (const r of rows ?? []) {
      for (const s of r.stops) pins.push({ id: r.trip.id + '|' + s.id, lat: s.lat, lon: s.lon, color: r.trip.color })
      lines.push({ id: r.trip.id, color: r.trip.color, points: r.stops.map((s) => [s.lat, s.lon]) })
    }
    return { pins, lines }
  }, [rows])

  async function create() {
    const clean = name.trim()
    if (!clean) return
    const count = await db.trips.count()
    const trip: Trip = { id: newId(), name: clean, createdAt: Date.now(), color: TRIP_COLORS[count % TRIP_COLORS.length] }
    await db.trips.add(trip)
    setCreating(false)
    setName('')
    go({ name: 'trip', id: trip.id })
  }

  if (!rows) return null

  return (
    <div className="page">
      <div className="bar">
        <h1 className="brand">MyTrip</h1>
        <button className="icon-btn" onClick={() => go({ name: 'settings' })} aria-label="Impostazioni">
          <IconGear />
        </button>
      </div>

      {inSafariTab && (
        <div className="note-box warm">
          Per usarla come app: tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>. I viaggi salvati qui in Safari non si vedono nell'app installata.
        </div>
      )}

      {pins.length > 0 && <MapView pins={pins} lines={lines} fitKey={String(pins.length)} onPin={(id) => go({ name: 'trip', id: id.split('|')[0] })} />}

      {rows.length === 0 ? (
        <div className="empty-state">
          <h2>Il primo viaggio</h2>
          <p>Crea un viaggio e aggiungi le foto dalla galleria: data e luogo di ogni scatto diventano tappe sulla mappa.</p>
        </div>
      ) : (
        <h2 className="section-title">I miei viaggi</h2>
      )}

      <div className="trips">
        {rows.map((r) => (
          <button key={r.trip.id} className="trip-card" onClick={() => go({ name: 'trip', id: r.trip.id })}>
            {r.cover ? (
              <img className="cover" src={thumbUrl(r.cover)} alt="" />
            ) : (
              <div className="cover empty">
                <IconPhotos />
              </div>
            )}
            <div>
              <h3>
                <span className="dot" style={{ background: r.trip.color }} />
                {r.trip.name}
              </h3>
              <div className="meta">
                {r.stops.length ? fmtRange(r.stops[0].first, r.stops[r.stops.length - 1].first) : 'Ancora nessuna foto'}
              </div>
              {r.stops.length > 0 && (
                <div className="meta">
                  {plural(r.stops.length, 'tappa', 'tappe')} · {plural(r.photos, 'foto', 'foto')}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => setCreating(true)}>
          <IconPlus /> Nuovo viaggio
        </button>
      </div>

      {creating && (
        <Sheet onClose={() => setCreating(false)}>
          <h2>Nuovo viaggio</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <input className="field" autoFocus placeholder="Es. Giappone 2026" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <button className="btn" type="submit" disabled={!name.trim()}>
              Crea
            </button>
          </form>
        </Sheet>
      )}
    </div>
  )
}
