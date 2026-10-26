import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteTrip, type Photo, type Stop } from './db'
import { dayOf, fmtDayLong, fmtRange, fmtTime, plural } from './format'
import { geocodePending } from './geocode'
import { IconBack, IconMore, IconPhotos } from './icons'
import { importPhotos, type ImportProgress, type ImportReport } from './importPhotos'
import MapView, { type MapPin } from './MapView'
import Sheet from './Sheet'
import StopSheet from './StopSheet'
import { thumbUrl } from './thumbUrl'
import { setBusy } from './update'
import { deliverFile, exportTrip } from './backup'
import type { Route } from './App'

type Panel =
  | { kind: 'none' }
  | { kind: 'import'; progress: ImportProgress; report?: ImportReport }
  | { kind: 'menu' }
  | { kind: 'rename'; value: string }
  | { kind: 'delete' }

export default function TripScreen({ id, go }: { id: string; go: (r: Route) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
  const [openStop, setOpenStop] = useState<string>()
  const [focus, setFocus] = useState<string>()
  const [error, setError] = useState<string>()

  const data = useLiveQuery(async () => {
    const trip = await db.trips.get(id)
    const stops = await db.stops.where('tripId').equals(id).sortBy('start')
    const photos = await db.photos.where('tripId').equals(id).sortBy('time')
    return { trip, stops, photos }
  }, [id])

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

  const pins = useMemo<MapPin[]>(
    () =>
      (data?.stops ?? []).map((s) => {
        const cover = byStop.get(s.id)?.[0]
        return { id: s.id, lat: s.lat, lon: s.lon, color: data?.trip?.color ?? '#888', img: cover ? thumbUrl(cover) : undefined, count: byStop.get(s.id)?.length, star: s.star }
      }),
    [data, byStop],
  )
  const lines = useMemo(() => (data?.trip ? [{ id: 'route', color: data.trip.color, points: data.stops.map((s) => [s.lat, s.lon] as [number, number]) }] : []), [data])

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

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (input.current) input.current.value = ''
    if (files.length === 0) return
    setBusy(true)
    setPanel({ kind: 'import', progress: { done: 0, total: files.length } })
    try {
      const report = await importPhotos(id, files, (progress) => setPanel({ kind: 'import', progress }))
      setPanel({ kind: 'import', progress: { done: files.length, total: files.length }, report })
      void navigator.storage?.persist?.()
      void geocodePending()
    } catch (e) {
      setPanel({ kind: 'none' })
      setError(`Import non riuscito: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onExport() {
    setPanel({ kind: 'none' })
    try {
      await deliverFile(await exportTrip(id))
    } catch (e) {
      setError(`Export non riuscito: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stop = data.stops.find((s) => s.id === openStop)
  const importing = panel.kind === 'import' && !panel.report

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
          <MapView
            tall
            pins={pins}
            lines={lines}
            fitKey={`${id}|${data.stops.length}`}
            focusId={focus}
            onPin={(sid) => {
              setFocus(sid)
              setOpenStop(sid)
            }}
          />
          <p className="meta" style={{ margin: '10px 2px 0' }}>
            {fmtRange(data.stops[0].first, data.stops.at(-1)!.first)} · {plural(data.stops.length, 'tappa', 'tappe')} · {plural(data.photos.length, 'foto', 'foto')}
          </p>
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
          <input ref={input} className="hidden-input" type="file" accept="image/*" multiple onChange={(e) => void onFiles(e.target.files)} />
        </label>
      </div>

      {days.map((d, i) => (
        <section key={d.day}>
          <div className="day">
            <b>Giorno {i + 1}</b>
            <span>{fmtDayLong(d.stops[0].first)}</span>
          </div>
          {d.stops.map((s) => {
            const photos = byStop.get(s.id) ?? []
            return (
              <button
                key={s.id}
                className="stop"
                onClick={() => {
                  setFocus(s.id)
                  setOpenStop(s.id)
                }}
              >
                <span className="time">{fmtTime(s.first)}</span>
                <span className="body">
                  <span className="place" style={{ display: 'block' }}>
                    {s.star && <span className="star">★ </span>}
                    {s.place ?? (s.geocoded ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : 'Cerco il nome del luogo…')}
                  </span>
                  <span className="meta">
                    {plural(photos.length, 'foto', 'foto')}
                    {s.note ? ' · ' + s.note : ''}
                  </span>
                  <span className="strip">
                    {photos.slice(0, 5).map((p) => (
                      <img key={p.id} src={thumbUrl(p)} alt="" loading="lazy" />
                    ))}
                  </span>
                </span>
              </button>
            )
          })}
        </section>
      ))}

      {stop && <StopSheet stop={stop} photos={byStop.get(stop.id) ?? []} color={trip.color} onClose={() => setOpenStop(undefined)} />}

      {panel.kind === 'import' && (
        <Sheet locked={importing} onClose={() => setPanel({ kind: 'none' })}>
          {!panel.report ? (
            <>
              <h2>Leggo le foto…</h2>
              <div className="progress">
                <div style={{ width: `${(panel.progress.done / Math.max(1, panel.progress.total)) * 100}%` }} />
              </div>
              <p className="small">
                {panel.progress.done} di {panel.progress.total}. Tieni l'app aperta fino alla fine.
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
            <button className="btn ghost" onClick={() => setPanel({ kind: 'rename', value: trip.name })}>Rinomina</button>
            <button className="btn ghost" onClick={() => void onExport()} disabled={data.photos.length === 0}>Esporta il viaggio</button>
            <button className="btn danger" onClick={() => setPanel({ kind: 'delete' })}>Elimina il viaggio</button>
          </div>
        </Sheet>
      )}

      {panel.kind === 'rename' && (
        <Sheet onClose={() => setPanel({ kind: 'none' })}>
          <h2>Rinomina</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const value = panel.value.trim()
              if (!value) return
              void db.trips.update(id, { name: value })
              setPanel({ kind: 'none' })
            }}
          >
            <input className="field" autoFocus value={panel.value} maxLength={80} onChange={(e) => setPanel({ kind: 'rename', value: e.target.value })} />
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
