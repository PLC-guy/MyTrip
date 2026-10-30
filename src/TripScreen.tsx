import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteTrip, stopTitle, TRIP_COLORS, type Photo, type Stop, type TripKind } from './db'
import KindPicker from './KindPicker'
import { dayOf, daySpan, fmtDayLong, fmtDayShort, fmtDuration, fmtRange, fmtStamp, fmtTime, plural } from './format'
import { geocodePending } from './geocode'
import { IconBack, IconMore, IconPhotos, IconPlay, IconStop } from './icons'
import { importPhotos, type ImportProgress, type ImportReport } from './importPhotos'
import MapView, { type MapLine, type MapPin } from './MapView'
import Sheet, { SWAP_MS } from './Sheet'
import StopSheet from './StopSheet'
import DayNav from './DayNav'
import CoverSheet from './CoverSheet'
import { thumbUrl } from './thumbUrl'
import { setBusy } from './update'
import { shareExport } from './exportFlow'
import { exportKml } from './kml'
import { fmtKm, tripStats } from './stats'
import { TRANSPORTS, transportOf } from './transport'
import { legsToLines } from './legs'
import { useLegs } from './useLegs'
import { routesPending } from './routing'
import { describeWeather, weatherPending } from './weather'
import ShareSheet from './ShareSheet'
import NotifySheet from './NotifySheet'
import { leaveShare, pullShare, useSyncStatus } from './sync'
import type { Route } from './App'

type Panel =
  | { kind: 'none' }
  /** Selettore di iOS aperto: dopo «Aggiungi» iOS prepara le foto prima di consegnarle. */
  | { kind: 'picking' }
  | { kind: 'import'; progress: ImportProgress; report?: ImportReport; timing?: { deliverMs?: number; readMs: number } }
  | { kind: 'menu' }
  | { kind: 'cover' }
  | { kind: 'color' }
  | { kind: 'share' }
  | { kind: 'notify' }
  | { kind: 'rename'; value: string; type: TripKind }
  | { kind: 'delete' }
  | { kind: 'diary'; day: string; value: string }
  | { kind: 'transport'; stopId: string }

/** Quanto resta su ogni tappa l'itinerario animato. */
const PLAY_MS = 2600

export default function TripScreen({ id, initialStop, go }: { id: string; initialStop?: string; go: (r: Route) => void }) {
  const input = useRef<HTMLInputElement>(null)
  /** Quando si è aperto il selettore: per sapere quanto ha impiegato iOS a consegnare le foto. */
  const pickedAt = useRef<number | undefined>(undefined)
  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
  /**
   * Scambio animato fra due fogli (richiesta dell'utente, 30/10/2026): dal menu ⋯
   * a condivisione, nome e tipo, copertina o colore il menu scende e l'altro sale; scelto, scende e il
   * menu risale. `leaving` = il foglio attuale sta uscendo; `swapped` = quello
   * nuovo entra salendo da sotto.
   */
  const [leaving, setLeaving] = useState(false)
  const [swapped, setSwapped] = useState(false)
  const swapTo = (next: Panel) => {
    setLeaving(true)
    setTimeout(() => {
      setLeaving(false)
      setSwapped(true)
      setPanel(next)
    }, SWAP_MS)
  }
  const [openStop, setOpenStop] = useState<string | undefined>(initialStop)
  const [focus, setFocus] = useState<string | undefined>(initialStop)
  const [error, setError] = useState<string>()
  /** Indice della tappa mostrata dall'itinerario animato; null = fermo. */
  const [play, setPlay] = useState<number | null>(null)

  const data = useLiveQuery(async () => {
    const trip = await db.trips.get(id)
    const stops = await db.stops.where('tripId').equals(id).sortBy('start')
    const photos = await db.photos.where('tripId').equals(id).sortBy('time')
    return { trip, stops, photos }
  }, [id])

  /**
   * Viaggio condiviso in diretta (sync.ts). Seguito da un altro telefono: sola
   * lettura, niente import né modifiche; all'apertura si chiedono le novità.
   */
  const share = useLiveQuery(() => db.shares.get(id), [id])
  const readOnly = share?.role === 'follow'
  const sync = useSyncStatus(id)
  useEffect(() => {
    if (readOnly) void pullShare(id)
  }, [id, readOnly])

  // Selezione annullata nel selettore di iOS: si toglie l'avviso di attesa.
  // (React non inoltra l'evento `cancel` degli input, si ascolta a mano.)
  const ready = data !== undefined
  useEffect(() => {
    const el = input.current
    if (!el) return
    const onCancel = () => setPanel((p) => (p.kind === 'picking' ? { kind: 'none' } : p))
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [ready])

  const stopCount = data?.stops.length ?? 0
  useEffect(() => {
    if (play === null) return
    const t = setTimeout(() => setPlay((p) => (p === null || p + 1 >= stopCount ? null : p + 1)), PLAY_MS)
    return () => clearTimeout(t)
  }, [play, stopCount])

  const byStop = useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of data?.photos ?? []) {
      const list = map.get(p.stopId) ?? []
      list.push(p)
      map.set(p.stopId, list)
    }
    return map
  }, [data?.photos])

  const days = useMemo(() => {
    const out: { day: string; stops: Stop[] }[] = []
    for (const s of data?.stops ?? []) {
      const d = dayOf(s.first)
      if (out.at(-1)?.day !== d) out.push({ day: d, stops: [] })
      out.at(-1)!.stops.push(s)
    }
    return out
  }, [data?.stops])

  const color = data?.trip?.color ?? '#888'
  /**
   * GIORNI SULLA MAPPA (richiesta dell'utente, 28/10/2026): nei viaggi di più
   * giorni ogni pallino porta il numero del suo giorno, e sotto la mappa si può
   * isolare un giorno solo. ⚠️ Niente colori diversi per giorno: provati nella
   * 0.10.0, non convincevano.
   */
  const [dayFilter, setDayFilter] = useState<string | null>(null)
  /**
   * Numero del giorno contato sul CALENDARIO dal primo giorno del viaggio, non
   * fra i soli giorni con foto: se il 2 non ci sono foto, il 3 resta «Giorno 3»
   * (richiesta dell'utente, 30/10/2026). Così torna con i «Giorni» delle schede.
   */
  const dayNum = useMemo(() => new Map(days.map((d) => [d.day, daySpan(days[0].day, d.day)])), [days])
  const showDay = (s: Stop) => dayFilter === null || dayOf(s.first) === dayFilter
  const pins = useMemo<MapPin[]>(
    () =>
      (data?.stops ?? []).filter(showDay).map((s) => {
        const cover = byStop.get(s.id)?.[0]
        const label = days.length > 1 ? String(dayNum.get(dayOf(s.first))) : undefined
        return { id: s.id, lat: s.lat, lon: s.lon, color, img: cover ? thumbUrl(cover) : undefined, count: byStop.get(s.id)?.length, star: s.star, label, meal: !!s.meal }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.stops, byStop, color, days, dayNum, dayFilter],
  )

  // Un tratto per ogni coppia di tappe, col percorso stimato se c'è. Durante
  // l'itinerario animato si disegnano solo i tratti già percorsi.
  const legs = useLegs(id, data?.stops)
  // Con un giorno isolato, solo i tratti fra due tappe di quel giorno.
  const inDay = useMemo(() => {
    if (dayFilter === null) return () => true
    const ids = new Set((data?.stops ?? []).filter((s) => dayOf(s.first) === dayFilter).map((s) => s.id))
    const prev = new Map((data?.stops ?? []).map((s, i, all) => [s.id, all[i - 1]?.id]))
    return (l: MapLine) => ids.has(l.id) && ids.has(prev.get(l.id) ?? '')
  }, [data?.stops, dayFilter])
  const lines = useMemo<MapLine[]>(() => legsToLines(legs, color, play === null ? legs.length + 1 : play + 1).filter(inDay), [legs, color, play, inDay])
  const allLines = useMemo<MapLine[]>(() => legsToLines(legs, color).filter(inDay), [legs, color, inDay])
  const warnings = legs.filter((l) => l.warning)

  // Percorsi mancanti di questo viaggio, prima degli altri.
  useEffect(() => {
    void routesPending(id)
  }, [id])

  const stats = useMemo(() => (data ? tripStats(data.stops, data.photos, legs) : undefined), [data, legs])

  if (!data) return null
  if (!data.trip) {
    return (
      <div className="page">
        <div className="empty-state">
          <h2>Viaggio non trovato</h2>
          <button className="btn" onClick={() => go({ name: 'home' })}>Torna ai viaggi</button>
        </div>
      </div>
    )
  }
  const trip = data.trip
  const dayNumber = (day: string) => dayNum.get(day) ?? 1

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (input.current) input.current.value = ''
    // ⚠️ Due tempi separati, mostrati nel riepilogo: quanto iOS ha impiegato a
    // consegnare le foto (selettore → app) e quanto l'app a leggerle. Servono a
    // capire sull'iPhone dove si perde tempo (prova del 28/10/2026).
    const start = performance.now()
    const deliverMs = pickedAt.current != null ? Date.now() - pickedAt.current : undefined
    pickedAt.current = undefined
    if (files.length === 0) {
      setPanel({ kind: 'none' })
      return
    }
    setBusy(true)
    setPanel({ kind: 'import', progress: { done: 0, total: files.length } })
    // Schermo acceso fino alla fine: se si spegne, iOS sospende l'app a metà.
    const wake = await navigator.wakeLock?.request('screen').catch(() => undefined)
    try {
      const report = await importPhotos(id, files, (progress) => setPanel({ kind: 'import', progress }))
      setPanel({ kind: 'import', progress: { done: files.length, total: files.length }, report, timing: { deliverMs, readMs: performance.now() - start } })
      void navigator.storage?.persist?.()
      void geocodePending()
      void weatherPending()
      void routesPending(id)
    } catch (e) {
      setPanel({ kind: 'none' })
      setError(`Import non riuscito: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      void wake?.release().catch(() => {})
      setBusy(false)
    }
  }

  async function deliver(make: () => Promise<File>) {
    setPanel({ kind: 'none' })
    try {
      await shareExport('File per Google Maps', make)
    } catch (e) {
      setError(`Export non riuscito: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const openLeg = (stopId: string) => setPanel({ kind: 'transport', stopId })

  const openAt = (sid: string) => {
    setPlay(null)
    setFocus(sid)
    setOpenStop(sid)
  }

  const stopIndex = data.stops.findIndex((s) => s.id === openStop)
  const stop = stopIndex >= 0 ? data.stops[stopIndex] : undefined
  const importing = panel.kind === 'import' && !panel.report
  const playing = play !== null ? data.stops[play] : undefined

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>{trip.name}</h1>
        <button className="icon-btn" onClick={() => {
            setSwapped(false)
            setPanel({ kind: 'menu' })
          }} aria-label="Altro">
          <IconMore />
        </button>
      </div>

      {data.stops.length > 0 && (
        <>
          <MapView tall pins={pins} lines={lines} fitLines={allLines} fitKey={`${id}|${data.stops.length}|${dayFilter ?? ''}`} focusId={playing?.id ?? focus} onPin={openAt}>
            {data.stops.length > 1 && (
              <button
                className="icon-btn map-play"
                aria-label={playing ? "Ferma l'itinerario" : "Ripercorri l'itinerario"}
                onClick={() => {
                  setOpenStop(undefined)
                  setDayFilter(null)
                  setPlay(playing ? null : 0)
                }}
              >
                {playing ? <IconStop /> : <IconPlay />}
              </button>
            )}
            {playing && (
              <div className="map-caption" onClick={() => openAt(playing.id)}>
                {byStop.get(playing.id)?.[0] && <img src={thumbUrl(byStop.get(playing.id)![0])} alt="" />}
                <div style={{ minWidth: 0 }}>
                  <span className="meta">
                    {transportOf(playing.transport)?.icon} Giorno {dayNumber(dayOf(playing.first))} · {fmtTime(playing.first)} · {play! + 1}/{data.stops.length}
                  </span>
                  <b>{stopTitle(playing)}</b>
                </div>
              </div>
            )}
          </MapView>
          {days.length > 1 && (
            // Filtro dei giorni: la mappa mostra tutto o un giorno solo.
            <div className="segmented day-filter" role="radiogroup" aria-label="Giorni sulla mappa">
              <button type="button" role="radio" aria-checked={dayFilter === null} className={dayFilter === null ? 'on' : ''} onClick={() => setDayFilter(null)}>
                Tutti
              </button>
              {days.map((d) => (
                <button key={d.day} type="button" role="radio" aria-checked={dayFilter === d.day} className={dayFilter === d.day ? 'on' : ''} title={fmtDayShort(d.stops[0].first)} onClick={() => { setPlay(null); setDayFilter(d.day) }}>
                  G{dayNumber(d.day)}
                </button>
              ))}
            </div>
          )}
          <p className="meta" style={{ margin: '10px 2px 0' }}>
            {fmtRange(data.stops[0].first, data.stops.at(-1)!.first)} · {plural(data.stops.length, 'tappa', 'tappe')} · {plural(data.photos.length, 'foto', 'foto')}
          </p>
          {share && (
            <p className="small share-line">
              {readOnly ? (share.by ? `👁 Viaggio di ${share.by}` : '👁 Segui questo viaggio') : '📡 Condiviso in diretta'}
              {sync.busy
                ? readOnly
                  ? ' · scarico le novità…'
                  : ' · carico le novità…'
                : share.error
                  ? ` · ⚠️ ${share.error}`
                  : share.at
                    ? ` · aggiornato ${fmtStamp(share.at)}`
                    : ''}
            </p>
          )}
          {warnings.length > 0 && !readOnly && (
            <button
              className="note-box warm warn-banner"
              onClick={() => {
                const leg = warnings[0]
                document.getElementById(`leg-${leg.toStopId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                openLeg(leg.toStopId)
              }}
            >
              ⚠️ {plural(warnings.length, 'tratto da verificare', 'tratti da verificare')}: il mezzo dedotto non torna. Tocca per vedere il primo.
            </button>
          )}
        </>
      )}

      {error && (
        <div className="note-box warm" style={{ marginTop: 12 }} onClick={() => setError(undefined)}>
          {error}
        </div>
      )}

      {data.stops.length === 0 && (
        <div className="empty-state">
          <h2>Aggiungi le foto</h2>
          <p>{readOnly ? 'Ancora nessuna foto: arriveranno qui man mano.' : 'Scegli le foto del viaggio dalla Libreria foto. Entrano solo quelle con data e posizione.'}</p>
        </div>
      )}

      {!readOnly && (
      <div style={{ marginTop: 14 }}>
        <label className="btn">
          <IconPhotos /> Aggiungi foto
          {/* ⚠️ Solo image/*. Nella 0.3.0 c'era anche image/heic,image/heif, per
              far consegnare a iOS gli originali senza convertirli in JPEG: sul
              telefono è andata PEGGIO, anche poche foto restavano minuti nel
              selettore (prova dell'utente, 28/10/2026). Non rimetterlo. */}
          <input
            ref={input}
            className="hidden-input"
            type="file"
            accept="image/*"
            multiple
            onClick={() => {
              pickedAt.current = Date.now()
              setPanel({ kind: 'picking' })
            }}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
      </div>
      )}

      {stats && stats.stops > 0 && (
        <>
          <h2 className="section-title">Il viaggio in numeri</h2>
          <div className="stats">
            <div><b>{fmtKm(stats.routeKm)}</b><span>percorsi (stima)</span></div>
            <div><b>{stats.days}</b><span>{stats.days === 1 ? 'giorno' : 'giorni'}</span></div>
            <div><b>{stats.stops}</b><span>{stats.stops === 1 ? 'tappa' : 'tappe'}</span></div>
            <div><b>{stats.photos}</b><span>foto</span></div>
            <div><b>{stats.places}</b><span>{stats.places === 1 ? 'località' : 'località'}</span></div>
            <div><b>{stats.countries.length}</b><span>{stats.countries.length === 1 ? 'paese' : 'paesi'}</span></div>
            {stats.highest && (
              <div className="wide"><b>{stats.highest.alt} m</b><span>punto più alto · {stats.highest.where}</span></div>
            )}
            {stats.busiest && stats.days > 1 && (
              <div className="wide"><b>{stats.busiest.photos} foto</b><span>il giorno più intenso · {fmtDayLong(stats.busiest.day)}</span></div>
            )}
            {stats.byTransport.length > 0 && (
              <div className="wide">
                <b>{stats.byTransport.map((t) => `${t.icon} ${fmtKm(t.km)}`).join('  ')}</b>
                <span>per mezzo · indicato da te</span>
              </div>
            )}
            {stats.byInferred.length > 0 && (
              <div className="wide">
                <b>{stats.byInferred.map((t) => `${t.icon} ${fmtKm(t.km)}`).join('  ')}</b>
                <span>per mezzo · dedotto dall'app</span>
              </div>
            )}
          </div>
          {stats.countries.length > 0 && <p className="small">{stats.countries.join(' · ')}</p>}
        </>
      )}

      {days.length > 0 && <h2 className="section-title">Le tappe</h2>}
      <div className="timeline">
      {days.map((d) => (
        <section key={d.day}>
          <div className="day">
            <b>Giorno {dayNumber(d.day)}</b>
            <span>{fmtDayLong(d.stops[0].first)}</span>
          </div>
          {readOnly ? (
            trip.diary?.[d.day] && <div className="diary"><span className="diary-text">{trip.diary[d.day]}</span></div>
          ) : (
            <button className="diary" onClick={() => setPanel({ kind: 'diary', day: d.day, value: trip.diary?.[d.day] ?? '' })}>
              {trip.diary?.[d.day] ? <span className="diary-text">{trip.diary[d.day]}</span> : <span className="diary-add">✎ Scrivi il diario del giorno</span>}
            </button>
          )}
          {d.stops.map((s) => {
            const photos = byStop.get(s.id) ?? []
            const idx = data.stops.indexOf(s)
            const leg = idx > 0 ? legs[idx - 1] : undefined
            const w = s.weather && describeWeather(s.weather.code)
            return (
              <Fragment key={s.id}>
                {leg && (
                  // Mezzo scelto: pieno. Dedotto: tratteggiato, col «?». Da verificare: ⚠️.
                  <button id={`leg-${s.id}`} className={`leg${leg.inferred ? '' : ' set'}${leg.warning && !readOnly ? ' warn' : ''}`} disabled={readOnly} onClick={() => openLeg(s.id)}>
                    <span className="leg-label">
                      {leg.warning && !readOnly ? '⚠️ ' : ''}
                      {leg.icon} {leg.inferred ? `${leg.label.toLowerCase()}?` : leg.label} · {fmtKm(leg.km)}
                      {leg.minutes != null && leg.minutes >= 1 && !leg.straight ? ` · ${fmtDuration(leg.minutes)}` : ''}
                    </span>
                  </button>
                )}
                <button className="stop" onClick={() => openAt(s.id)}>
                  <span className="stop-head">
                    <span className="label">
                      {fmtTime(s.first)} · {plural(photos.length, 'foto', 'foto')}
                    </span>
                    {w && s.weather && (
                      <span className="label soft">
                        {w.icon} {s.weather.temp}°
                      </span>
                    )}
                  </span>
                  <span className="stop-title">
                    <span className="n">{String(idx + 1).padStart(2, '0')}</span>
                    <b>
                      {stopTitle(s)}
                      {s.star && <span className="star"> ★</span>}
                    </b>
                  </span>
                  {s.meal && (
                    <span className="note meal-line">
                      🍽️ {s.meal.name}
                      {s.meal.rating ? <span className="meal-stars"> {'★'.repeat(s.meal.rating)}</span> : null}
                    </span>
                  )}
                  {s.note && <span className="note">{s.note}</span>}
                  <span className="strip">
                    {photos.slice(0, 6).map((p) => (
                      <img key={p.id} src={thumbUrl(p)} alt="" loading="lazy" />
                    ))}
                  </span>
                </button>
              </Fragment>
            )
          })}
        </section>
      ))}
      </div>
      {days.length > 0 && <DayNav days={days.length} />}

      {stop && (
        <StopSheet
          key={stop.id}
          stop={stop}
          photos={byStop.get(stop.id) ?? []}
          color={trip.color}
          readOnly={readOnly}
          prev={data.stops[stopIndex - 1]}
          next={data.stops[stopIndex + 1]}
          onClose={() => setOpenStop(undefined)}
          onOpen={openAt}
        />
      )}

      {panel.kind === 'transport' && (() => {
        // Dati sempre freschi dalla lista: il foglio resta aperto mentre arrivano i percorsi.
        const to = data.stops.find((s) => s.id === panel.stopId)
        const at = to ? data.stops.indexOf(to) : -1
        const leg = legs[at - 1]
        if (!to || !leg) return null
        const from = data.stops[at - 1]
        const setStop = (patch: Partial<Stop>) => {
          void db.stops.update(to.id, patch).then(() => routesPending(id))
        }
        return (
          <Sheet onClose={() => setPanel({ kind: 'none' })}>
            <h2>Come ci sei arrivato?</h2>
            <p className="small">
              Da «{stopTitle(from)}» a «{stopTitle(to)}» · {fmtKm(leg.straightKm)} in linea d'aria
            </p>
            <div className="note-box" style={{ marginTop: 10 }}>
              {leg.inferred ? 'Mezzo dedotto dalla distanza: ' : 'Mezzo indicato: '}
              <b>
                {leg.icon} {leg.label}
              </b>
              {leg.mode === 'plane'
                ? ` · rotta in linea d'aria, ${fmtKm(leg.km)}`
                : leg.pending
                ? ' · percorso in calcolo (serve la connessione)'
                : leg.straight
                  ? ' · linea dritta'
                  : ` · percorso stimato ${fmtKm(leg.km)}${leg.minutes != null ? `, ${fmtDuration(leg.minutes)}` : ''}`}
              {leg.warning && <p style={{ margin: '8px 0 0' }}>⚠️ {leg.warning}</p>}
            </div>
            <div className="transport-grid">
              {TRANSPORTS.map((t) => (
                <button key={t.key} className={to.transport === t.key ? 'on' : ''} onClick={() => setStop({ transport: t.key })}>
                  <span>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="stack">
              {to.transport && (
                <button className="btn ghost" onClick={() => setStop({ transport: undefined })}>
                  Lascia decidere all'app
                </button>
              )}
              {leg.mode !== 'plane' && leg.mode !== 'train' && (
                <label className="check">
                  <input type="checkbox" checked={!!to.straight} onChange={(e) => setStop({ straight: e.target.checked || undefined })} />
                  Disegna in linea dritta (se il percorso stimato non è quello che hai fatto)
                </label>
              )}
              <button className="btn" onClick={() => setPanel({ kind: 'none' })}>
                Fatto
              </button>
            </div>
            <p className="small">
              Il percorso è una stima: la strada più veloce con quel mezzo, non necessariamente quella che hai fatto. Treno e barche senza una tratta mappata restano in linea dritta.
            </p>
          </Sheet>
        )
      })()}

      {panel.kind === 'diary' && (
        <Sheet onClose={() => setPanel({ kind: 'none' })}>
          <h2>Giorno {dayNumber(panel.day)}</h2>
          <p className="small">{fmtDayLong(panel.day + 'T12:00:00')}</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const diary = { ...(trip.diary ?? {}) }
              const clean = panel.value.trim()
              if (clean) diary[panel.day] = clean
              else delete diary[panel.day]
              void db.trips.update(id, { diary })
              setPanel({ kind: 'none' })
            }}
          >
            <textarea className="field diary-field" autoFocus placeholder="Com'è andata oggi?" value={panel.value} onChange={(e) => setPanel({ ...panel, value: e.target.value })} />
            <button className="btn" type="submit">Salva</button>
          </form>
        </Sheet>
      )}

      {panel.kind === 'picking' && (
        <Sheet locked onClose={() => {}}>
          <h2>Scegli le foto…</h2>
          <p className="small" style={{ marginTop: 8 }}>
            Dopo aver toccato «Aggiungi», iOS prepara le foto prima di passarle all'app: se sono tante, o se sono su iCloud, può volerci un po'. Attendi senza chiudere: l'import parte da solo.
          </p>
          <div className="progress">
            <div className="indeterminate" />
          </div>
          <div className="stack">
            <button className="btn ghost" onClick={() => setPanel({ kind: 'none' })}>
              Non ho scelto nessuna foto
            </button>
          </div>
        </Sheet>
      )}

      {panel.kind === 'import' && (
        <Sheet locked={importing} onClose={() => setPanel({ kind: 'none' })}>
          {!panel.report ? (
            <>
              <h2>Leggo le foto…</h2>
              <div className="progress">
                <div style={{ width: `${(panel.progress.done / Math.max(1, panel.progress.total)) * 100}%` }} />
              </div>
              <p className="small">
                {panel.progress.done} di {panel.progress.total}
              </p>
              <p className="note-box warm" style={{ marginTop: 12 }}>
                Tieni l'app aperta finché non finisce: se passi a un'altra app, iOS può interrompere l'import. Le foto già lette restano salvate.
              </p>
            </>
          ) : (
            <>
              <h2>{panel.report.added > 0 ? `${plural(panel.report.added, 'foto aggiunta', 'foto aggiunte')}` : 'Nessuna foto nuova'}</h2>
              <div className="list" style={{ marginTop: 14 }}>
                <div><span className="k">Aggiunte</span><b>{panel.report.added}</b></div>
                <div><span className="k">Già presenti</span><b>{panel.report.duplicates}</b></div>
                <div><span className="k">Scartate</span><b>{panel.report.rejected.length}</b></div>
              </div>
              {panel.timing && (
                <p className="small" style={{ marginTop: 10 }}>
                  {panel.timing.deliverMs != null && <>Consegna da iOS: {fmtSeconds(panel.timing.deliverMs)} · </>}
                  Lettura nell'app: {fmtSeconds(panel.timing.readMs)}
                </p>
              )}
              {panel.report.rejected.length > 0 && (
                // Niente elenco dei file scartati: iOS li chiama con codici
                // (lettere e numeri) da cui non si risale alla foto (richiesta
                // dell'utente, 28/10/2026).
                <p className="small" style={{ marginTop: 12 }}>
                  Entrano solo foto con data e posizione nei metadati. Le foto senza queste informazioni vengono scartate.
                </p>
              )}
              <div className="stack">
                <button className="btn" onClick={() => setPanel({ kind: 'none' })}>Fatto</button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {panel.kind === 'menu' && (
        <Sheet onClose={() => setPanel({ kind: 'none' })} leaving={leaving} swap={swapped}>
          <h2>{trip.name}</h2>
          {readOnly ? (
            <>
              <div className="stack">
                <button className="btn ghost" onClick={() => swapTo({ kind: 'notify' })}>
                  🔔 Notifiche · {share?.notify ? (share.notify.mode === 'each' ? 'a ogni novità' : `ogni giorno alle ${share.notify.hour}`) : 'spente'}
                </button>
                <button className="btn ghost" disabled={sync.busy} onClick={() => void pullShare(id)}>{sync.busy ? 'Aggiorno…' : 'Aggiorna ora'}</button>
                <button className="btn ghost" onClick={() => void deliver(() => exportKml(id))} disabled={data.stops.length === 0}>Esporta per Google Maps (KML)</button>
                <button className="btn danger" onClick={() => setPanel({ kind: 'delete' })}>Smetti di seguire</button>
              </div>
              <p className="small">Segui questo viaggio in sola lettura: le novità arrivano da sole quando apri l'app.</p>
            </>
          ) : (
          <>
          <div className="stack">
            <button className="btn ghost" onClick={() => swapTo({ kind: 'share' })}>📡 Condividi in diretta{share ? ' · attiva' : ''}</button>
            <button className="btn ghost" onClick={() => swapTo({ kind: 'rename', value: trip.name, type: trip.kind ?? 'piacere' })}>Nome e tipo di viaggio</button>
            <button className="btn ghost" onClick={() => swapTo({ kind: 'cover' })}>Scegli la copertina</button>
            <button className="btn ghost" onClick={() => swapTo({ kind: 'color' })}>
              <span className="dot" style={{ background: trip.color, width: 12, height: 12, margin: 0 }} /> Colore della traccia
            </button>
            <button className="btn ghost" onClick={() => void deliver(() => exportKml(id))} disabled={data.stops.length === 0}>Esporta per Google Maps (KML)</button>
            <button className="btn danger" onClick={() => setPanel({ kind: 'delete' })}>Elimina il viaggio</button>
          </div>
          <p className="small">Per salvare il viaggio o passarlo a qualcuno: Impostazioni › Backup e ripristino › Esporta alcuni viaggi.</p>
          <p className="small">
            Il file KML si importa in Google My Maps (Crea una nuova mappa → Importa) o si apre in Google Earth: contiene tappe, date, note e percorso, ma non le foto.
          </p>
          </>
          )}
        </Sheet>
      )}

      {panel.kind === 'share' && <ShareSheet trip={trip} onClose={() => swapTo({ kind: 'menu' })} leaving={leaving} swap={swapped} />}

      {panel.kind === 'notify' && share && <NotifySheet share={share} onClose={() => swapTo({ kind: 'menu' })} leaving={leaving} swap={swapped} />}

      {panel.kind === 'cover' && <CoverSheet trip={trip} onClose={() => swapTo({ kind: 'menu' })} leaving={leaving} swap={swapped} />}

      {panel.kind === 'color' && (
        // Colore della traccia del viaggio, scelto dopo la creazione (richiesta dell'utente).
        <Sheet onClose={() => swapTo({ kind: 'menu' })} leaving={leaving} swap={swapped}>
          <h2>Colore della traccia</h2>
          <div className="swatches" style={{ marginTop: 14 }}>
            {TRIP_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${trip.color.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={`Colore ${c}`}
                onClick={() => {
                  void db.trips.update(id, { color: c })
                  swapTo({ kind: 'menu' })
                }}
              />
            ))}
            {/* Colore libero: il selettore di sistema dell'iPhone. */}
            <label className={`swatch swatch-custom${TRIP_COLORS.some((c) => c.toLowerCase() === trip.color.toLowerCase()) ? '' : ' on'}`} aria-label="Scegli un altro colore">
              <input type="color" value={trip.color} onChange={(e) => void db.trips.update(id, { color: e.target.value })} />
            </label>
          </div>
        </Sheet>
      )}

      {panel.kind === 'rename' && (
        // Come copertina e colore: dal menu e ritorno al menu con lo scambio animato.
        <Sheet onClose={() => swapTo({ kind: 'menu' })} leaving={leaving} swap={swapped}>
          <h2>Nome e tipo</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const value = panel.value.trim()
              if (!value) return
              void db.trips.update(id, { name: value, kind: panel.type })
              swapTo({ kind: 'menu' })
            }}
          >
            <input className="field" autoFocus value={panel.value} maxLength={80} onChange={(e) => setPanel({ ...panel, value: e.target.value })} />
            <KindPicker value={panel.type} onChange={(type) => setPanel({ ...panel, type })} />
            <button className="btn" type="submit" disabled={!panel.value.trim()}>Salva</button>
          </form>
        </Sheet>
      )}

      {panel.kind === 'delete' && (
        <Sheet onClose={() => setPanel({ kind: 'none' })}>
          <h2>{readOnly ? `Smettere di seguire «${trip.name}»?` : `Eliminare «${trip.name}»?`}</h2>
          <p className="small">
            {readOnly
              ? 'Il viaggio sparisce da questo telefono. Chi lo condivide non perde niente.'
              : `Si cancellano dall'app ${plural(data.stops.length, 'tappa', 'tappe')} e ${plural(data.photos.length, 'miniatura', 'miniature')}. Le foto originali nella galleria non si toccano. Se vuoi tenerne una copia, prima esporta il viaggio.${share ? ' Chi lo segue non riceverà più novità.' : ''}`}
          </p>
          <div className="stack">
            <button
              className="btn danger"
              onClick={async () => {
                // Condiviso: via anche dal server (se manca la rete, resta lì cifrato).
                // Seguito: via l'iscrizione alle notifiche.
                await leaveShare(id).catch(() => {})
                await deleteTrip(id)
                go({ name: 'home' })
              }}
            >
              {readOnly ? 'Smetti di seguire' : 'Elimina'}
            </button>
            <button className="btn ghost" onClick={() => setPanel({ kind: 'none' })}>Annulla</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

/** «45 s», «3 min 20 s»: per i tempi dell'import. */
function fmtSeconds(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
