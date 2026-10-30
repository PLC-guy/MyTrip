import { useMemo, useState } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, KIND_FILTERS, newId, TRIP_COLORS, type KindFilter, type Photo, type Share, type Stop, type Trip, type TripKind } from './db'
import { legsToLines } from './legs'
import { useLegs } from './useLegs'
import KindPicker from './KindPicker'
import { daySpan, fmtRange, fmtStamp, plural } from './format'
import { IconGear, IconGlobe, IconPhotos, IconPlus, IconSearch, IconStar } from './icons'
import MapView, { type MapLine, type MapPin } from './MapView'
import Sheet from './Sheet'
import { thumbUrl } from './thumbUrl'
import DayNav from './DayNav'
import FollowSheet from './FollowSheet'
import { backupDue, describeBackupAge, photosToKeep, runBackup, snoozeBackup, useBackupState } from './backupReminder'
import type { Route } from './App'

const KIND_KEY = 'mytrip:home-kind'

/** «In viaggio adesso»: ultima foto entro 48 ore (scelta dell'utente, 30/10/2026). */
const LIVE_MS = 48 * 3600_000

interface TripRow {
  trip: Trip
  stops: Stop[]
  cover?: { id: string; thumb: Blob }
  photos: number
  /** Paesi del viaggio, in ordine di visita. */
  countries: string[]
  /** Condiviso in diretta da qui, o seguito da un altro telefono (sync.ts). */
  share?: Share
}

/** `follow`: link «#/segui/…» aperto nell'app (sul computer): il foglio parte già compilato. */
export default function HomeScreen({ go, follow }: { go: (r: Route) => void; follow?: string }) {
  const [creating, setCreating] = useState(false)
  const [following, setFollowing] = useState<string | undefined>(follow)
  const [backingUp, setBackingUp] = useState(false)
  const backup = useBackupState()
  const photoCount = useLiveQuery(photosToKeep)
  const due = photoCount != null && backupDue(backup, photoCount)

  async function doBackup() {
    setBackingUp(true)
    try {
      await runBackup()
    } finally {
      setBackingUp(false)
    }
  }
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TripKind>('piacere')

  /**
   * Filtro Piacere/Lavoro (richiesta dell'utente, 30/10/2026): vale per elenco,
   * mappa di tutti i viaggi e sottotitolo. Ricordato su questo dispositivo.
   */
  const [kindFilter, setKindFilter] = useState<KindFilter>(() => {
    try {
      const saved = localStorage.getItem(KIND_KEY)
      return KIND_FILTERS.some((f) => f.key === saved) ? (saved as KindFilter) : 'tutti'
    } catch {
      return 'tutti'
    }
  })
  const chooseKind = (k: KindFilter) => {
    setKindFilter(k)
    try {
      localStorage.setItem(KIND_KEY, k)
    } catch {
      // Senza memoria del browser il filtro vale solo fino alla chiusura.
    }
  }

  const allRows = useLiveQuery(async (): Promise<TripRow[]> => {
    const trips = await db.trips.toArray()
    const stops = await db.stops.orderBy('start').toArray()
    const shares = new Map((await db.shares.toArray()).map((s) => [s.tripId, s]))
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
      out.push({ trip, stops: own, cover, photos, countries, share: shares.get(trip.id) })
    }
    // Il più recente in alto; i viaggi appena creati e ancora vuoti sopra tutti.
    const when = (r: TripRow) => (r.stops.length ? r.stops[r.stops.length - 1].end : Number.MAX_SAFE_INTEGER - (Date.now() - r.trip.createdAt))
    return out.sort((a, b) => when(b) - when(a))
  })
  /**
   * VIAGGI SEGUITI A PARTE (richiesta dell'utente, 30/10/2026): un viaggio
   * seguito è di qualcun altro, tipicamente di chi parte, seguito da chi resta a
   * casa. Ha la sua sezione «Viaggi che segui» e non entra in «I miei viaggi», nel
   * sottotitolo, nel filtro né nella mappa di tutti i viaggi (se ci sono viaggi
   * propri). Paesi, Locali e Speciali lo escludono; Cerca lo segna.
   */
  const ownRows = useMemo(() => allRows?.filter((r) => r.share?.role !== 'follow'), [allRows])
  const followed = useMemo(() => allRows?.filter((r) => r.share?.role === 'follow') ?? [], [allRows])
  // Il filtro compare solo se ci sono viaggi di tutti e due i tipi; senza, vale «Tutti».
  const mixed = new Set(ownRows?.map((r) => r.trip.kind ?? 'piacere')).size > 1
  const activeKind = mixed ? kindFilter : 'tutti'
  const rows = useMemo(() => (activeKind === 'tutti' ? ownRows : ownRows?.filter((r) => (r.trip.kind ?? 'piacere') === activeKind)), [ownRows, activeKind])
  const live = (r: TripRow) => r.stops.length > 0 && Date.now() - r.stops[r.stops.length - 1].end < LIVE_MS
  // Sezione dei seguiti in cima se uno è in corso, o se viaggi propri non ce ne sono.
  const followFirst = followed.some(live) || (ownRows?.length ?? 0) === 0

  /**
   * Viaggio selezionato per l'anteprima: la mappa mostra solo lui, con le sue
   * tappe, e sotto la scheda compare «Visualizza tappe». Si apre il viaggio
   * solo da lì; un altro tocco seleziona un altro viaggio.
   */
  const [selected, setSelected] = useState<string>()
  const preview = allRows?.find((r) => r.trip.id === selected)
  // Tratti con i percorsi stimati, solo per il viaggio in anteprima.
  const previewLegs = useLegs(preview?.trip.id, preview?.stops)

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
      return { pins, lines: legsToLines(previewLegs, preview.trip.color), fitKey: `anteprima:${preview.trip.id}:${preview.stops.length}` }
    }
    const pins: MapPin[] = []
    const lines: MapLine[] = []
    // Senza viaggi propri (chi resta a casa) la mappa mostra quelli seguiti.
    for (const r of rows?.length ? rows : followed) {
      for (const s of r.stops) pins.push({ id: r.trip.id + '|' + s.id, lat: s.lat, lon: s.lon, color: r.trip.color })
      lines.push({ id: r.trip.id, color: r.trip.color, points: r.stops.map((s) => [s.lat, s.lon]) })
    }
    return { pins, lines, fitKey: `tutti:${pins.length}` }
  }, [rows, followed, preview, covers, previewLegs])

  const select = (id: string) => {
    const next = id === selected ? undefined : id
    setSelected(next)
    if (!next) return
    // La scheda scelta si allinea subito sotto la mappa agganciata in alto
    // (richiesta dell'utente, 30/10/2026). Dopo il disegno: «Visualizza tappe»
    // cambia l'altezza della scheda.
    requestAnimationFrame(() => {
      const card = document.getElementById(`trip-${next}`)
      const map = document.querySelector('.home-map')
      if (!card || !map) return
      // Dove sarà il fondo della mappa a scorrimento finito: agganciata in alto,
      // sotto la barra di stato (non dov'è adesso, se la pagina è ancora in cima).
      const status = document.querySelector('.statusbar-bg')?.getBoundingClientRect().height ?? 0
      const under = status + map.getBoundingClientRect().height + 10
      window.scrollTo({ top: window.scrollY + card.getBoundingClientRect().top - under, behavior: 'smooth' })
    })
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

  if (!rows || !allRows || !ownRows) return null

  // Una scheda: biglietto come quelle del sito; i viaggi seguiti hanno un bordo
  // tratteggiato, chi viaggia, «in viaggio adesso» e l'ultimo aggiornamento.
  const card = (r: TripRow) => {
    const follow = r.share?.role === 'follow' ? r.share : undefined
    return (
      <div key={r.trip.id} id={`trip-${r.trip.id}`} className={`trip-item${follow ? ' followed' : ''}${r.trip.id === selected ? ' on' : ''}`}>
        <button className="trip-card" onClick={() => (r.stops.length ? select(r.trip.id) : go({ name: 'trip', id: r.trip.id }))} aria-pressed={r.trip.id === selected}>
          <div className="trip-head">
            <span className="label">
              <span className="dot" style={{ background: r.trip.color }} />
              {follow ? (follow.by ? `👁 Viaggio di ${follow.by}` : '👁 Seguito') : r.trip.kind === 'lavoro' ? '💼 Lavoro' : 'Piacere'}
              {r.stops.length ? ` · ${r.stops[0].first.slice(0, 4)}` : ''}
              {r.share?.role === 'owner' ? ' · 📡 In diretta' : ''}
            </span>
            {follow && !follow.ended && live(r) ? (
              <span className="live-badge">in viaggio adesso</span>
            ) : (
              r.countries.length > 0 && <span className="label soft">{r.countries.join(' · ')}</span>
            )}
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
          {/* La perforazione del biglietto, con le due tacche ai lati, come sul sito di Greta. */}
          <div className="perf" aria-hidden="true" />
          {r.stops.length ? (
            <div className="facts">
              <div>
                <span className="label soft">Date</span>
                <b>{fmtRange(r.stops[0].first, r.stops[r.stops.length - 1].first)}</b>
              </div>
              <div>
                <span className="label soft">Giorni</span>
                <b>{daySpan(r.stops[0].first, r.stops[r.stops.length - 1].first)}</b>
              </div>
              <div>
                <span className="label soft">Foto</span>
                <b>{r.photos}</b>
              </div>
            </div>
          ) : (
            <span className="meta">{follow ? 'Ancora nessuna foto' : 'Ancora nessuna foto: tocca per aggiungerle'}</span>
          )}
          {follow && (
            <span className="meta follow-meta">
              {follow.ended ? 'Non è più condiviso: ora esiste solo su questo telefono, tienilo nel backup.' : follow.at ? `Aggiornato ${fmtStamp(follow.at)}` : 'In attesa del primo aggiornamento'}
            </span>
          )}
        </button>
        {r.trip.id === selected && (
          <button className="btn open-trip" onClick={() => go({ name: 'trip', id: r.trip.id })}>
            Visualizza tappe →
          </button>
        )}
      </div>
    )
  }

  // Con un viaggio scelto, spazio sotto l'ultimo elenco: anche l'ultima scheda deve poter salire fin sotto la mappa.
  const followedSection = followed.length > 0 && (
    <>
      <div className="section-head">
        <h2 className="section-title">Viaggi che segui</h2>
        <button className="small-link" onClick={() => setFollowing('')}>+ Segui</button>
      </div>
      <div className={`trips${selected && !followFirst ? ' room' : ''}`}>{followed.map(card)}</div>
    </>
  )

  return (
    <div className="page">
      <div className="bar">
        <h1 className="brand">MyTrip</h1>
        <button className="icon-btn" onClick={() => go({ name: 'settings' })} aria-label="Impostazioni">
          <IconGear />
        </button>
      </div>
      {ownRows.length > 0 && (
        <p className="subtitle">
          {plural(rows.length, 'viaggio', 'viaggi')} · {plural(new Set(rows.flatMap((r) => r.countries)).size, 'paese', 'paesi')} ·{' '}
          {/* Giorni di calendario di tutti i viaggi, come i «Giorni» delle schede. */}
          {plural(
            rows.reduce((n, r) => n + (r.stops.length ? daySpan(r.stops[0].first, r.stops[r.stops.length - 1].first) : 0), 0),
            'giorno in viaggio',
            'giorni in viaggio',
          )}
        </p>
      )}

      {ownRows.length > 0 && (
        <div className="shortcuts">
          <button onClick={() => go({ name: 'countries' })}>
            <IconGlobe /> Paesi
          </button>
          <button onClick={() => go({ name: 'meals' })}>
            <span aria-hidden="true">🍽️</span> Locali
          </button>
          <button onClick={() => go({ name: 'stars' })}>
            <IconStar /> Speciali
          </button>
          <button onClick={() => go({ name: 'search' })}>
            <IconSearch /> Cerca
          </button>
        </div>
      )}

      {due && (
        <div className="note-box warm backup-due">
          <span>
            <b>Fai un backup</b> · ultimo: {describeBackupAge(backup)}. I viaggi esistono solo su questo telefono.
          </span>
          <span className="row">
            <button className="btn small-btn" disabled={backingUp} onClick={() => void doBackup()}>
              Esporta ora
            </button>
            <button className="btn ghost small-btn" onClick={snoozeBackup}>
              Più tardi
            </button>
          </span>
        </div>
      )}

      {pins.length > 0 && (
        <div className="home-map">
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
        </div>
      )}

      {allRows.length === 0 && (
        <div className="empty-state">
          <h2>Il primo viaggio</h2>
          <p>Crea un viaggio e aggiungi le foto dalla galleria: data e luogo di ogni scatto diventano tappe sulla mappa.</p>
          <button className="btn" onClick={() => setCreating(true)}>
            <IconPlus /> Nuovo viaggio
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setFollowing('')}>
            Segui il viaggio di qualcuno
          </button>
        </div>
      )}

      {followFirst && followedSection}

      {allRows.length > 0 && (
        // «Nuovo viaggio» accanto al titolo e non fisso sullo schermo: copriva
        // «Visualizza tappe» dell'anteprima. Un viaggio nuovo si crea appena
        // aperta l'app, non dopo aver scorso l'elenco (scelta dell'utente, 27/10/2026).
        // Chi ha solo viaggi seguiti vede un invito più discreto.
        <div className="section-head">
          <h2 className="section-title">I miei viaggi</h2>
          <button className={ownRows.length ? 'btn small-btn' : 'btn ghost small-btn'} onClick={() => setCreating(true)}>
            <IconPlus /> {ownRows.length ? 'Nuovo viaggio' : 'Crea un tuo viaggio'}
          </button>
        </div>
      )}

      {mixed && (
        <div className="segmented" role="radiogroup" aria-label="Quali viaggi">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={activeKind === f.key}
              className={activeKind === f.key ? 'on' : ''}
              onClick={() => {
                chooseKind(f.key)
                setSelected(undefined)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className={`trips${selected && (followFirst || !followed.length) ? ' room' : ''}`}>{rows.map(card)}</div>

      {!followFirst && followedSection}

      {/* Solo «torna in cima», senza giorni (richiesta dell'utente). */}
      <DayNav days={0} />

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
          <button
            className="small-link"
            style={{ marginTop: 14 }}
            onClick={() => {
              setCreating(false)
              setFollowing('')
            }}
          >
            Hai ricevuto un link? Segui un viaggio
          </button>
        </Sheet>
      )}

      {following !== undefined && (
        <FollowSheet
          initial={following}
          onClose={() => {
            setFollowing(undefined)
            if (follow !== undefined) go({ name: 'home' })
          }}
          onFollowed={(id) => {
            setFollowing(undefined)
            go({ name: 'trip', id })
          }}
        />
      )}
    </div>
  )
}
