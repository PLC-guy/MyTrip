import { useMemo, useState } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, TRIP_COLORS, type Photo, type Stop, type Trip, type TripKind } from './db'
import { legLines } from './transport'
import KindPicker from './KindPicker'
import { fmtRange, plural } from './format'
import { IconGear, IconGlobe, IconPhotos, IconPlus, IconSearch, IconStar } from './icons'
import MapView, { type MapLine, type MapPin } from './MapView'
import Sheet from './Sheet'
import { thumbUrl } from './thumbUrl'
import type { Route } from './App'

interface TripRow {
  trip: Trip
  stops: Stop[]
  cover?: { id: string; thumb: Blob }
  photos: number
  /** Paesi del viaggio, in ordine di visita. */
  countries: string[]
}

/** iPhone fuori dall'app installata: i dati del browser sono un archivio a parte. */
const inSafariTab = /iPhone|iPad/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone

export default function HomeScreen({ go }: { go: (r: Route) => void }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TripKind>('piacere')

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
      const own = stops.filter((s) => s.tripId === trip.id)
      const countries = [...new Set(own.map((s) => s.country).filter((c): c is string => !!c))]
      out.push({ trip, stops: own, cover, photos, countries })
    }
    // Il più recente in alto; i viaggi appena creati e ancora vuoti sopra tutti.
    const when = (r: TripRow) => (r.stops.length ? r.stops[r.stops.length - 1].end : Number.MAX_SAFE_INTEGER - (Date.now() - r.trip.createdAt))
    return out.sort((a, b) => when(b) - when(a))
  })

  /**
   * Viaggio selezionato per l'anteprima: la mappa mostra solo lui, con le sue
   * tappe, e sotto la scheda compare «Visualizza tappe». Si apre il viaggio
   * solo da lì; un altro tocco seleziona un altro viaggio.
   */
  const [selected, setSelected] = useState<string>()
  const preview = rows?.find((r) => r.trip.id === selected)

  // Una miniatura per tappa, solo per il viaggio in anteprima.
  const covers = useLiveQuery(async () => {
    if (!selected) return undefined
    const map = new Map<string, Photo>()
    for (const p of await db.photos.where('tripId').equals(selected).sortBy('time')) if (!map.has(p.stopId)) map.set(p.stopId, p)
    return map
  }, [selected])

  const { pins, lines, fitKey } = useMemo(() => {
    if (preview) {
      const pins: MapPin[] = preview.stops.map((s) => {
        const cover = covers?.get(s.id)
        return { id: preview.trip.id + '|' + s.id, lat: s.lat, lon: s.lon, color: preview.trip.color, img: cover ? thumbUrl(cover) : undefined, star: s.star }
      })
      return { pins, lines: legLines(preview.stops, preview.trip.color), fitKey: `anteprima:${preview.trip.id}:${preview.stops.length}` }
    }
    const pins: MapPin[] = []
    const lines: MapLine[] = []
    for (const r of rows ?? []) {
      for (const s of r.stops) pins.push({ id: r.trip.id + '|' + s.id, lat: s.lat, lon: s.lon, color: r.trip.color })
      lines.push({ id: r.trip.id, color: r.trip.color, points: r.stops.map((s) => [s.lat, s.lon]) })
    }
    return { pins, lines, fitKey: `tutti:${pins.length}` }
  }, [rows, preview, covers])

  const select = (id: string) => {
    setSelected(id === selected ? undefined : id)
    // La mappa è in cima: se la scheda toccata è più in basso, si torna su a guardarla.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function create() {
    const clean = name.trim()
    if (!clean) return
    const count = await db.trips.count()
    const trip: Trip = { id: newId(), name: clean, createdAt: Date.now(), color: TRIP_COLORS[count % TRIP_COLORS.length], kind }
    await db.trips.add(trip)
    setCreating(false)
    setName('')
    setKind('piacere')
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
      {rows.length > 0 && (
        <p className="subtitle">
          {plural(rows.length, 'viaggio', 'viaggi')} · {plural(new Set(rows.flatMap((r) => r.countries)).size, 'paese', 'paesi')} ·{' '}
          {plural(
            rows.reduce((n, r) => n + r.stops.length, 0),
            'tappa',
            'tappe',
          )}
        </p>
      )}

      {rows.length > 0 && (
        <div className="shortcuts">
          <button onClick={() => go({ name: 'search' })}>
            <IconSearch /> Cerca
          </button>
          <button onClick={() => go({ name: 'stars' })}>
            <IconStar /> Speciali
          </button>
          <button onClick={() => go({ name: 'countries' })}>
            <IconGlobe /> Paesi
          </button>
        </div>
      )}

      {inSafariTab && (
        <div className="note-box warm">
          Per usarla come app: tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>. I viaggi salvati qui in Safari non si vedono nell'app installata.
        </div>
      )}

      {pins.length > 0 && (
        <MapView
          pins={pins}
          lines={lines}
          fitKey={fitKey}
          onPin={(id) => {
            const [tripId, stopId] = id.split('|')
            // In anteprima un puntatore apre quella tappa; sulla mappa di tutti i viaggi, seleziona il viaggio.
            if (preview) go({ name: 'trip', id: tripId, stop: stopId })
            else select(tripId)
          }}
        >
          {preview && (
            <button className="map-chip" onClick={() => setSelected(undefined)}>
              <span className="dot" style={{ background: preview.trip.color }} />
              {preview.trip.name} <span className="map-chip-x">✕ tutti</span>
            </button>
          )}
        </MapView>
      )}

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
          <div key={r.trip.id} className={`trip-item${r.trip.id === selected ? ' on' : ''}`}>
          {/* Scheda come quelle del sito: etichetta in maiuscoletto, titolo, separatore, dati in colonne. */}
          <button className="trip-card" onClick={() => (r.stops.length ? select(r.trip.id) : go({ name: 'trip', id: r.trip.id }))} aria-pressed={r.trip.id === selected}>
            <div className="trip-head">
              <span className="label">
                <span className="dot" style={{ background: r.trip.color }} />
                {r.trip.kind === 'lavoro' ? '💼 Lavoro' : 'Piacere'}
                {r.stops.length ? ` · ${r.stops[0].first.slice(0, 4)}` : ''}
              </span>
              {r.countries.length > 0 && <span className="label soft">{r.countries.join(' · ')}</span>}
            </div>
            <div className="trip-main">
              <h3>{r.trip.name}</h3>
              {r.cover ? (
                <img className="cover" src={thumbUrl(r.cover)} alt="" />
              ) : (
                <div className="cover" style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
                  <IconPhotos />
                </div>
              )}
            </div>
            <hr className="rule" />
            {r.stops.length ? (
              <div className="facts">
                <div>
                  <span className="label soft">Date</span>
                  <b>{fmtRange(r.stops[0].first, r.stops[r.stops.length - 1].first)}</b>
                </div>
                <div>
                  <span className="label soft">Tappe</span>
                  <b>{r.stops.length}</b>
                </div>
                <div>
                  <span className="label soft">Foto</span>
                  <b>{r.photos}</b>
                </div>
              </div>
            ) : (
              <span className="meta">Ancora nessuna foto: tocca per aggiungerle</span>
            )}
          </button>
          {r.trip.id === selected && (
            <button className="btn open-trip" onClick={() => go({ name: 'trip', id: r.trip.id })}>
              Visualizza tappe →
            </button>
          )}
          </div>
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
            <KindPicker value={kind} onChange={setKind} />
            <button className="btn" type="submit" disabled={!name.trim()}>
              Crea
            </button>
          </form>
        </Sheet>
      )}
    </div>
  )
}
