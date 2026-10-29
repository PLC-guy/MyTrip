import { useEffect, useState } from 'react'
import { db, type Photo, type Stop } from './db'
import { nearbyPlaces, RADII, type NearbyPlace } from './places'
import Sheet from './Sheet'
import MapsChooser from './MapsChooser'
import { IconMap } from './icons'

/**
 * «Dove hai mangiato?»: i locali vicini (OpenStreetMap), dal più vicino, oppure
 * il nome scritto a mano. Il voto già dato resta.
 * Si apre dall'icona 🍽️ di una foto (idea dell'utente, 28/10/2026): si cerca
 * attorno a QUELLA foto, la foto del piatto, più precisa del centro della tappa.
 * Il locale resta uno per tappa.
 */
export default function MealSheet({ stop, photo, onClose }: { stop: Stop; photo?: Photo; onClose: () => void }) {
  const lat = photo?.lat ?? stop.lat
  const lon = photo?.lon ?? stop.lon
  const [places, setPlaces] = useState<NearbyPlace[]>()
  const [error, setError] = useState(false)
  const [radius, setRadius] = useState<number>(RADII[0])
  /** Locale da controllare nelle mappe prima di sceglierlo. */
  const [peek, setPeek] = useState<NearbyPlace>()
  const [name, setName] = useState(stop.meal && !stop.meal.lat ? stop.meal.name : '')

  useEffect(() => {
    let cancelled = false
    nearbyPlaces(lat, lon, radius)
      .then((p) => !cancelled && setPlaces(p))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [lat, lon, radius])
  const wider = radius < RADII[1] && (
    <button className="btn ghost small-btn" type="button" onClick={() => { setPlaces(undefined); setError(false); setRadius(RADII[1]) }}>
      Cerca più lontano (fino a {RADII[1]} m)
    </button>
  )

  const save = (meal: { name: string; kind?: string; lat?: number; lon?: number; address?: string }) => {
    void db.stops.update(stop.id, { meal: { ...meal, rating: stop.meal?.rating, photoId: photo?.id ?? stop.meal?.photoId } })
    onClose()
  }

  return (
    <Sheet onClose={onClose}>
      <h2>Dove hai mangiato?</h2>
      {!places && !error && <p className="small">Cerco i locali vicini…</p>}
      {error && <p className="small">Non riesco a cercare i locali: serve la connessione, oppure il servizio non risponde. Puoi scrivere il nome qui sotto.</p>}
      {places && places.length === 0 && (
        <>
          <p className="small">OpenStreetMap non conosce locali entro {radius} m. Scrivi il nome qui sotto{radius < RADII[1] ? ', o cerca più lontano' : ''}.</p>
          {wider}
        </>
      )}
      {places && places.length > 0 && (
        <>
          <p className="small">{places.length >= 100 ? 'I 100 più vicini' : `${places.length} entro ${radius} m`}, dal più vicino{photo ? ' alla foto' : ''}. Al chiuso il GPS sbaglia di qualche decina di metri: se non sei sicuro, tocca la mappa accanto al nome per controllare.</p>
          <div className="list pick-list" style={{ marginTop: 10 }}>
            {places.map((p) => (
              // Riga = scegli il locale; icona a destra = guardalo prima nelle mappe
              // (richiesta dell'utente, 29/10/2026: per ritrovare un posto di cui
              // non si ricorda il nome).
              <div key={`${p.name}|${p.lat}|${p.lon}`} className={`meal-row${stop.meal?.name === p.name ? ' on' : ''}`}>
                <button className="meal-pick" onClick={() => save({ name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, address: p.address })}>
                  <span className="pick-text">
                    <b>{p.name}</b>
                    <span className="k">
                      {p.kind ? `${p.kind} · ` : ''}
                      {p.distance} m
                    </span>
                  </span>
                </button>
                <button className="meal-map" aria-label={`Guarda ${p.name} nelle mappe`} onClick={() => setPeek(p)}>
                  <IconMap />
                </button>
              </div>
            ))}
          </div>
          {wider}
        </>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          // Nome a mano: la località della tappa aiuta Google Maps a trovarlo.
          if (name.trim()) save({ name: name.trim(), address: stop.place })
        }}
      >
        <input className="field" value={name} maxLength={80} placeholder="Non è nell'elenco? Scrivi il nome" onChange={(e) => setName(e.target.value)} />
        <button className="btn" type="submit" disabled={!name.trim()}>
          Salva questo nome
        </button>
      </form>
      {peek && <MapsChooser target={{ name: peek.name, lat: peek.lat!, lon: peek.lon!, address: peek.address, search: true }} onClose={() => setPeek(undefined)} />}
    </Sheet>
  )
}
