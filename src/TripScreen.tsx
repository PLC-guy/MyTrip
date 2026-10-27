import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteTrip, stopTitle, type Photo, type Stop, type TripKind } from './db'
import KindPicker from './KindPicker'
import { dayOf, fmtDayLong, fmtDuration, fmtRange, fmtTime, plural } from './format'
import { geocodePending } from './geocode'
import { IconBack, IconMore, IconPhotos, IconPlay, IconStop } from './icons'
import { importPhotos, type ImportProgress, type ImportReport } from './importPhotos'
import MapView, { type MapLine, type MapPin } from './MapView'
import Sheet from './Sheet'
import StopSheet from './StopSheet'
import CoverSheet from './CoverSheet'
import { thumbUrl } from './thumbUrl'
import { setBusy } from './update'
import { deliverFile, exportTrip } from './backup'
import { exportKml } from './kml'
import { fmtKm, tripStats } from './stats'
import { TRANSPORTS, transportOf } from './transport'
import { legsToLines } from './legs'
import { useLegs } from './useLegs'
import { routesPending } from './routing'
import { describeWeather, weatherPending } from './weather'
import type { Route } from './App'

type Panel =
  | { kind: 'none' }
  /** Selettore di iOS aperto: dopo «Aggiungi» iOS prepara le foto prima di consegnarle. */
  | { kind: 'picking' }
  | { kind: 'import'; progress: ImportProgress; report?: ImportReport }
  | { kind: 'menu' }
  | { kind: 'cover' }
  | { kind: 'rename'; value: string; type: TripKind }
  | { kind: 'delete' }
  | { kind: 'diary'; day: string; value: string }
  | { kind: 'transport'; stopId: string }

/** Quanto resta su ogni tappa l'itinerario animato. */
const PLAY_MS = 2600

export default function TripScreen({ id, initialStop, go }: { id: string; initialStop?: string; go: (r: Route) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
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
  const pins = useMemo<MapPin[]>(
    () =>
      (data?.stops ?? []).map((s) => {
        const cover = byStop.get(s.id)?.[0]
        return { id: s.id, lat: s.lat, lon: s.lon, color, img: cover ? thumbUrl(cover) : undefined, count: byStop.get(s.id)?.length, star: s.star }
      }),
    [data?.stops, byStop, color],
  )

  // Un tratto per ogni coppia di tappe, col percorso stimato se c'è. Durante
  // l'itinerario animato si disegnano solo i tratti già percorsi.
  const legs = useLegs(id, data?.stops)
  const lines = useMemo<MapLine[]>(() => legsToLines(legs, color, play === null ? legs.length + 1 : play + 1), [legs, color, play])
  const allLines = useMemo<MapLine[]>(() => legsToLines(legs, color), [legs, color])
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
  const dayNumber = (day: string) => days.findIndex((d) => d.day === day) + 1

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (input.current) input.current.value = ''
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
      setPanel({ kind: 'import', progress: { done: files.length, total: files.length }, report })
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
      await deliverFile(await make())
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
        <button className="icon-btn" onClick={() => setPanel({ kind: 'menu' })} aria-label="Altro">
          <IconMore />
        </button>
      </div>

      {data.stops.length > 0 && (
        <>
          <MapView tall pins={pins} lines={lines} fitLines={allLines} fitKey={`${id}|${data.stops.length}`} focusId={playing?.id ?? focus} onPin={openAt}>
            {data.stops.length > 1 && (
              <button
                className="icon-btn map-play"
                aria-label={playing ? "Ferma l'itinerario" : "Ripercorri l'itinerario"}
                onClick={() => {
                  setOpenStop(undefined)
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
          <p className="meta" style={{ margin: '10px 2px 0' }}>
            {fmtRange(data.stops[0].first, data.stops.at(-1)!.first)} · {plural(data.stops.length, 'tappa', 'tappe')} · {plural(data.photos.length, 'foto', 'foto')}
          </p>
          {warnings.length > 0 && (
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
          <p>Scegli le foto del viaggio dalla Libreria foto. Entrano solo quelle con data e posizione.</p>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <label className="btn">
          <IconPhotos /> Aggiungi foto
          {/* ⚠️ image/heic dichiarato apposta: se la pagina accetta l'HEIC, iOS
              consegna gli originali senza convertirli prima in JPEG. Con 70
              foto la conversione teneva il selettore bloccato a lungo. */}
          <input
            ref={input}
            className="hidden-input"
            type="file"
            accept="image/*,image/heic,image/heif"
            multiple
            onClick={() => setPanel({ kind: 'picking' })}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
      </div>

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
      {days.map((d, i) => (
        <section key={d.day}>
          <div className="day">
            <b>Giorno {i + 1}</b>
            <span>{fmtDayLong(d.stops[0].first)}</span>
          </div>
          <button className="diary" onClick={() => setPanel({ kind: 'diary', day: d.day, value: trip.diary?.[d.day] ?? '' })}>
            {trip.diary?.[d.day] ? <span className="diary-text">{trip.diary[d.day]}</span> : <span className="diary-add">✎ Scrivi il diario del giorno</span>}
          </button>
          {d.stops.map((s) => {
            const photos = byStop.get(s.id) ?? []
            const idx = data.stops.indexOf(s)
            const leg = idx > 0 ? legs[idx - 1] : undefined
            const w = s.weather && describeWeather(s.weather.code)
            return (
              <Fragment key={s.id}>
                {leg && (
                  // Mezzo scelto: pieno. Dedotto: tratteggiato, col «?». Da verificare: ⚠️.
                  <button id={`leg-${s.id}`} className={`leg${leg.inferred ? '' : ' set'}${leg.warning ? ' warn' : ''}`} onClick={() => openLeg(s.id)}>
                    <span className="leg-label">
                      {leg.warning ? '⚠️ ' : ''}
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

      {stop && (
        <StopSheet
          key={stop.id}
          stop={stop}
          photos={byStop.get(stop.id) ?? []}
          color={trip.color}
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
              {panel.report.rejected.length > 0 && (
                <>
                  <p className="small" style={{ marginTop: 12 }}>
                    Entrano solo foto con data e posizione nei metadati. Quelle scattate da «Scatta foto», scelte da «File» o arrivate da altre app spesso non le hanno.
                  </p>
                  <div className="list">
                    {panel.report.rejected.slice(0, 30).map((r, i) => (
                      <div key={i}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                        <span className="k">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="stack">
                <button className="btn" onClick={() => setPanel({ kind: 'none' })}>Fatto</button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {panel.kind === 'menu' && (
        <Sheet onClose={() => setPanel({ kind: 'none' })}>
          <h2>{trip.name}</h2>
          <div className="stack">
            <button className="btn ghost" onClick={() => setPanel({ kind: 'rename', value: trip.name, type: trip.kind ?? 'piacere' })}>Nome e tipo di viaggio</button>
            <button className="btn ghost" onClick={() => setPanel({ kind: 'cover' })}>Scegli la copertina</button>
            <button className="btn ghost" onClick={() => void deliver(() => exportTrip(id))} disabled={data.photos.length === 0}>Esporta il viaggio</button>
            <button className="btn ghost" onClick={() => void deliver(() => exportKml(id))} disabled={data.stops.length === 0}>Esporta per Google Maps (KML)</button>
            <button className="btn danger" onClick={() => setPanel({ kind: 'delete' })}>Elimina il viaggio</button>
          </div>
          <p className="small">
            Il file KML si importa in Google My Maps (Crea una nuova mappa → Importa) o si apre in Google Earth: contiene tappe, date, note e percorso, ma non le foto.
          </p>
        </Sheet>
      )}

      {panel.kind === 'cover' && <CoverSheet trip={trip} onClose={() => setPanel({ kind: 'none' })} />}

      {panel.kind === 'rename' && (
        <Sheet onClose={() => setPanel({ kind: 'none' })}>
          <h2>Nome e tipo</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const value = panel.value.trim()
              if (!value) return
              void db.trips.update(id, { name: value, kind: panel.type })
              setPanel({ kind: 'none' })
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
          <h2>Eliminare «{trip.name}»?</h2>
          <p className="small">
            Si cancellano dall'app {plural(data.stops.length, 'tappa', 'tappe')} e {plural(data.photos.length, 'miniatura', 'miniature')}. Le foto originali nella galleria non si toccano. Se vuoi tenerne una copia, prima esporta il viaggio.
          </p>
          <div className="stack">
            <button
              className="btn danger"
              onClick={async () => {
                await deleteTrip(id)
                go({ name: 'home' })
              }}
            >
              Elimina
            </button>
            <button className="btn ghost" onClick={() => setPanel({ kind: 'none' })}>Annulla</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
