import { useEffect, useState } from 'react'
import HomeScreen from './HomeScreen'
import TripScreen from './TripScreen'
import SettingsScreen from './SettingsScreen'
import { geocodePending } from './geocode'
import { reloadLoopDetected } from './reloadGuard'
import { applyUpdate, startAutoUpdate } from './update'

export type Route = { name: 'home' } | { name: 'trip'; id: string } | { name: 'settings' }

// Una volta per caricamento della pagina, non a ogni disegno.
const LOOP_BROKEN = reloadLoopDetected()

/**
 * La schermata vive nell'indirizzo (#/viaggio/…): dopo un aggiornamento
 * automatico, che ricarica la pagina, si torna dove si era.
 */
function readRoute(): Route {
  const h = location.hash
  if (h.startsWith('#/viaggio/')) return { name: 'trip', id: decodeURIComponent(h.slice(10)) }
  if (h === '#/impostazioni') return { name: 'settings' }
  return { name: 'home' }
}

function writeRoute(r: Route): string {
  if (r.name === 'trip') return `#/viaggio/${encodeURIComponent(r.id)}`
  if (r.name === 'settings') return '#/impostazioni'
  return '#/'
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    if (!LOOP_BROKEN) startAutoUpdate(() => setUpdateReady(true))
    void navigator.storage?.persist?.()
    void geocodePending()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Ogni schermata si apre dall'inizio. Dopo il disegno: prima, la pagina
  // vecchia (più lunga) riporterebbe giù lo scorrimento.
  useEffect(() => window.scrollTo(0, 0), [route])

  const go = (r: Route) => {
    location.hash = writeRoute(r)
  }

  return (
    <>
      {updateReady && (
        <div className="banner">
          <button className="btn" onClick={() => void applyUpdate()}>
            Nuova versione pronta · tocca per aggiornare
          </button>
        </div>
      )}
      {route.name === 'home' && <HomeScreen go={go} />}
      {route.name === 'trip' && <TripScreen key={route.id} id={route.id} go={go} />}
      {route.name === 'settings' && <SettingsScreen go={go} />}
    </>
  )
}
