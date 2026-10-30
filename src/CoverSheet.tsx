import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, type Trip } from './db'
import { IconPhotos } from './icons'
import Sheet from './Sheet'
import { makeThumb } from './thumb'
import { forgetThumbs, thumbUrl } from './thumbUrl'

/**
 * Copertina del viaggio: una foto DI QUESTO viaggio, oppure un'immagine
 * caricata apposta dalla galleria. Quest'ultima non passa dai metadati e non
 * diventa una tappa: può essere anche una foto senza GPS.
 * ⚠️ Niente foto degli altri viaggi (fino alla 0.10.0 c'erano; tolte su
 * richiesta dell'utente, 28/10/2026).
 */
export default function CoverSheet({ trip, onClose, leaving, swap }: { trip: Trip; onClose: () => void; leaving?: boolean; swap?: boolean }) {
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState(false)

  const photos = useLiveQuery(() => db.photos.where('tripId').equals(trip.id).sortBy('time'), [trip.id])

  const dropOldImage = () => {
    if (trip.coverImageId) forgetThumbs([trip.coverImageId])
  }

  async function pick(photoId: string | undefined) {
    dropOldImage()
    await db.trips.update(trip.id, { coverPhotoId: photoId, coverImage: undefined, coverImageId: undefined })
    onClose()
  }

  async function upload(file: File | undefined) {
    if (!file) return
    setWorking(true)
    setError(undefined)
    try {
      const thumb = await makeThumb(file)
      dropOldImage()
      await db.trips.update(trip.id, { coverImage: thumb.blob, coverImageId: newId(), coverPhotoId: undefined })
      onClose()
    } catch {
      setError("Non riesco a leggere questa immagine.")
    } finally {
      setWorking(false)
    }
  }

  const current = trip.coverImage ? 'image' : trip.coverPhotoId

  return (
    <Sheet onClose={onClose} locked={working} leaving={leaving} swap={swap}>
      <h2>Copertina</h2>
      <p className="small">Scegli una foto di questo viaggio, oppure caricane una dalla galleria. Non verrà aggiunta alle tappe.</p>
      <div className="stack">
        <label className="btn" aria-disabled={working}>
          <IconPhotos /> {working ? 'Preparo la copertina…' : 'Scegli dalla galleria'}
          <input className="hidden-input" type="file" accept="image/*" disabled={working} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        <button className="btn ghost" onClick={() => void pick(undefined)} disabled={!current}>
          Automatica (la prima foto del viaggio)
        </button>
        {error && <div className="note-box warm">{error}</div>}
      </div>

      {trip.coverImage && trip.coverImageId && (
        <>
          <h3 className="section-title">Copertina attuale</h3>
          <div className="cover-grid">
            <img className="on" src={thumbUrl({ id: trip.coverImageId, thumb: trip.coverImage })} alt="" />
          </div>
        </>
      )}

      {photos && photos.length > 0 && (
        <>
          <h3 className="section-title">Foto del viaggio</h3>
          <div className="cover-grid">
            {photos.map((p) => (
              <button key={p.id} onClick={() => void pick(p.id)} aria-label={`Usa ${p.name} come copertina`}>
                <img className={current === p.id ? 'on' : ''} src={thumbUrl(p)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}
