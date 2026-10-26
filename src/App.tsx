import { useEffect, useState } from 'react'
import HomeScreen from './HomeScreen'
import TripScreen from './TripScreen'
import SettingsScreen from './SettingsScreen'
import StarsScreen from './StarsScreen'
import SearchScreen from './SearchScreen'
import CountriesScreen from './CountriesScreen'
import { geocodePending } from './geocode'
import { weatherPending } from './weather'
import { reloadLoopDetected } from './reloadGuard'
import { applyUpdate, startAutoUpdate } from './update'

export type Route =
  | { name: 'home' }
  | { name: 'trip'; id: string; stop?: string }
  | { name: 'settings' }
  | { name: 'stars' }
  | { name: 'search' }
  | { name: 'countries' }

// Una volta per caricamento della pagina, non a ogni disegno.
const LOOP_BROKEN = reloadLoopDetected()

/**
 * La schermata vive nell'indirizzo (#/viaggio/…): dopo un aggiornamento
 * automatico, che ricarica la pagina, si torna dove si era.
 */
function readRoute(): Route {
  const h = location.hash
  if (h.startsWith('#/viaggio/')) {
    const [id, stop] = h.slice(10).split('/').map(decodeURIComponent)
    return { name: 'trip', id, stop: stop || undefined }
  }
  if (h === '#/impostazioni') return { name: 'settings' }
  if (h === '#/speciali') return { name: 'stars' }
  if (h === '#/cerca') return { name: 'search' }
  if (h === '#/paesi') return { name: 'countries' }
  return { name: 'home' }
}

function writeRoute(r: Route): string {
  if (r.name === 'trip') return `#/viaggio/${encodeURIComponent(r.id)}${r.stop ? '/' + encodeURIComponent(r.stop) : ''}`
  if (r.name === 'settings') return '#/impostazioni'
  if (r.name === 'stars') return '#/speciali'
  if (r.name === 'search') return '#/cerca'
  if (r.name === 'countries') return '#/paesi'
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
    void weatherPending()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Ogni schermata si apre dall'inizio. Dopo il disegno: prima, la pagina
  // vecchia (più lunga) riporterebbe giù lo scorrimento.
  // ⚠️ Fra graffe: nei browser recenti scrollTo restituisce una Promise, e
  // React la prenderebbe per una funzione di pulizia (schermata bianca).
  // Non quando cambia solo la tappa aperta dentro lo stesso viaggio.
  const screenKey = route.name === 'trip' ? `trip:${route.id}` : route.name
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screenKey])

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
      {route.name === 'trip' && <TripScreen key={route.id} id={route.id} initialStop={route.stop} go={go} />}
      {route.name === 'settings' && <SettingsScreen go={go} />}
      {route.name === 'stars' && <StarsScreen go={go} />}
      {route.name === 'search' && <SearchScreen go={go} />}
      {route.name === 'countries' && <CountriesScreen go={go} />}
    </>
  )
}
