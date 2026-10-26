import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, type Photo, type Trip } from './db'
import { IconPhotos } from './icons'
import Sheet from './Sheet'
import { makeThumb } from './thumb'
import { forgetThumbs, thumbUrl } from './thumbUrl'

/**
 * Copertina del viaggio: una foto qualsiasi fra quelle dell'app (anche di altri
 * viaggi), oppure un'immagine caricata apposta. Quest'ultima non passa dai
 * metadati e non diventa una tappa: può essere anche una foto senza GPS.
 */
export default function CoverSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState(false)

  const groups = useLiveQuery(async () => {
    const trips = await db.trips.toArray()
    const out: { trip: Trip; photos: Photo[] }[] = []
    // Prima il viaggio di cui si sta scegliendo la copertina, poi gli altri.
    for (const t of trips.sort((a, b) => (a.id === trip.id ? -1 : b.id === trip.id ? 1 : b.createdAt - a.createdAt))) {
      const photos = await db.photos.where('tripId').equals(t.id).sortBy('time')
      if (photos.length) out.push({ trip: t, photos })
    }
    return out
  }, [trip.id])

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
    <Sheet onClose={onClose} locked={working}>
      <h2>Copertina</h2>
      <p className="small">Scegli una foto fra quelle caricate, oppure caricane una solo per la copertina: non verrà aggiunta alle tappe.</p>
      <div className="stack">
        <label className="btn" aria-disabled={working}>
          <IconPhotos /> {working ? 'Preparo la copertina…' : 'Carica una foto per la copertina'}
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

      {groups?.map((g) => (
        <section key={g.trip.id}>
          <h3 className="section-title">
            <span className="dot" style={{ background: g.trip.color }} />
            {g.trip.name}
          </h3>
          <div className="cover-grid">
            {g.photos.map((p) => (
              <button key={p.id} onClick={() => void pick(p.id)} aria-label={`Usa ${p.name} come copertina`}>
                <img className={current === p.id ? 'on' : ''} src={thumbUrl(p)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
