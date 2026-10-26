import { useState } from 'react'
import { db, deletePhoto, type Photo, type Stop } from './db'
import { fmtDateTime, fmtTime, plural } from './format'
import { IconMap, IconShare, IconTrash } from './icons'
import Sheet from './Sheet'
import { mapsUrl, shareStop } from './share'
import { thumbUrl } from './thumbUrl'

export default function StopSheet({ stop, photos, color, onClose }: { stop: Stop; photos: Photo[]; color: string; onClose: () => void }) {
  const [note, setNote] = useState(stop.note ?? '')
  const [toDelete, setToDelete] = useState<Photo>()
  const [msg, setMsg] = useState<string>()

  const saveNote = () => {
    const clean = note.trim()
    if (clean !== (stop.note ?? '')) void db.stops.update(stop.id, { note: clean || undefined })
  }

  return (
    <Sheet
      onClose={() => {
        saveNote()
        onClose()
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{stop.place ?? 'Tappa'}</h2>
          <div className="meta">
            <span className="dot" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 6 }} />
            {fmtDateTime(stop.first)}
            {stop.country ? ` · ${stop.country}` : ''}
          </div>
        </div>
        <button
          className={`star-btn${stop.star ? ' on' : ''}`}
          aria-label={stop.star ? 'Togli dai posti speciali' : 'Segna come posto speciale'}
          onClick={() => void db.stops.update(stop.id, { star: !stop.star || undefined })}
        >
          {stop.star ? '★' : '☆'}
        </button>
      </div>

      <div className="gallery">
        {photos.map((p) => (
          <figure key={p.id} className="shot" style={{ margin: 0, ['--r' as string]: p.width / p.height }}>
            <img src={thumbUrl(p)} alt="" />
            <figcaption className="cap">
              <span>
                {fmtTime(p.taken)} · {p.name}
              </span>
              <button aria-label="Togli questa foto" onClick={() => setToDelete(p)}>
                <IconTrash />
              </button>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="stack">
        <textarea className="field" placeholder="Una nota su questo posto…" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
        <div className="row">
          <button
            className="btn ghost"
            onClick={async () => {
              const r = await shareStop({ ...stop, note }, photos[0])
              if (r === 'copied') setMsg('Link copiato negli appunti')
            }}
          >
            <IconShare /> Condividi
          </button>
          <a className="btn ghost" href={mapsUrl(stop)} target="_blank" rel="noreferrer">
            <IconMap /> Apri in Mappe
          </a>
        </div>
        {msg && <p className="small">{msg}</p>}
        <p className="small">
          {plural(photos.length, 'foto', 'foto')} · {stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}
        </p>
      </div>

      {toDelete && (
        <Sheet onClose={() => setToDelete(undefined)}>
          <h2>Togliere questa foto?</h2>
          <p className="small">Si cancella solo la miniatura nell'app. La foto originale resta nella galleria.</p>
          <div className="stack">
            <button
              className="btn danger"
              onClick={async () => {
                const last = photos.length === 1
                await deletePhoto(toDelete.id)
                setToDelete(undefined)
                if (last) onClose()
              }}
            >
              Togli
            </button>
            <button className="btn ghost" onClick={() => setToDelete(undefined)}>Annulla</button>
          </div>
        </Sheet>
      )}
    </Sheet>
  )
}
