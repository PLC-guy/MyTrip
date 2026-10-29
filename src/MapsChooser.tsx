import { appleMapsUrl, googleMapsUrl, type MapTarget } from './share'
import Sheet from './Sheet'

/**
 * «Apri in…»: Mappe di Apple o Google Maps, a scelta ogni volta (richiesta
 * dell'utente, 29/10/2026: prima si apriva sempre Mappe). Si usa per la tappa e
 * per controllare un locale dell'elenco PRIMA di sceglierlo.
 * I link sono universali: se Google Maps è installata si apre l'app, altrimenti
 * il sito.
 */
export default function MapsChooser({ target, onClose }: { target: MapTarget; onClose: () => void }) {
  // Si chiude dopo il tocco, quando il link è già partito.
  const done = () => setTimeout(onClose, 300)
  return (
    <Sheet onClose={onClose}>
      <h2>Apri in…</h2>
      <p className="small">{target.name}</p>
      <div className="stack">
        <a className="btn ghost" href={appleMapsUrl(target)} target="_blank" rel="noreferrer" onClick={done}>
          Mappe di Apple
        </a>
        <a className="btn ghost" href={googleMapsUrl(target)} target="_blank" rel="noreferrer" onClick={done}>
          Google Maps
        </a>
      </div>
    </Sheet>
  )
}
