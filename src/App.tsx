import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import HomeScreen from './HomeScreen'
import TripScreen from './TripScreen'
import SettingsScreen from './SettingsScreen'
import StarsScreen from './StarsScreen'
import MealsScreen from './MealsScreen'
import SearchScreen from './SearchScreen'
import CountriesScreen from './CountriesScreen'
import ErrorBoundary from './ErrorBoundary'
import ExportSheet from './ExportSheet'
import type { SettingsPage } from './SettingsScreen'
import InstallGate from './InstallGate'
import { readEnvironment } from './install'
import { geocodePending } from './geocode'
import { weatherPending } from './weather'
import { convertThumbs, recolorTrips } from './db'
import { routesPending } from './routing'
import { startSync } from './sync'
import { reloadLoopDetected } from './reloadGuard'
import { applyUpdate, startAutoUpdate } from './update'

export type Route =
  | { name: 'home' }
  | { name: 'trip'; id: string; stop?: string }
  | { name: 'settings'; page?: SettingsPage }
  | { name: 'stars' }
  | { name: 'meals' }
  | { name: 'search' }
  | { name: 'countries' }
  /** Link di un viaggio condiviso (sync.ts): la Home con «Segui un viaggio» già compilato. */
  | { name: 'follow'; code: string }

// Una volta per caricamento della pagina, non a ogni disegno.
const LOOP_BROKEN = reloadLoopDetected()

/**
 * Sul telefono, aperta dal browser e non dalla Home: solo la guida
 * all'installazione (il perché è in `install.ts`). Sul computer l'app si usa
 * anche nel browser. In sviluppo la guida si vede con `?guida=ios` (o
 * `ios18`, `android`, `app`); `null` = niente guida.
 */
const ENV = readEnvironment()
const GUIDE = import.meta.env.DEV ? new URLSearchParams(location.search).get('guida') : !ENV.installed && ENV.platform !== 'desktop' ? '' : null

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
  if (h === '#/impostazioni/aspetto') return { name: 'settings', page: 'aspetto' }
  if (h === '#/impostazioni/backup') return { name: 'settings', page: 'backup' }
  if (h === '#/impostazioni/viaggiatore') return { name: 'settings', page: 'viaggiatore' }
  if (h === '#/speciali') return { name: 'stars' }
  if (h === '#/mangiato') return { name: 'meals' }
  if (h === '#/cerca') return { name: 'search' }
  if (h === '#/paesi') return { name: 'countries' }
  if (h.startsWith('#/segui/')) return { name: 'follow', code: h.slice(8) }
  return { name: 'home' }
}

function writeRoute(r: Route): string {
  if (r.name === 'trip') return `#/viaggio/${encodeURIComponent(r.id)}${r.stop ? '/' + encodeURIComponent(r.stop) : ''}`
  if (r.name === 'settings') return r.page ? `#/impostazioni/${r.page}` : '#/impostazioni'
  if (r.name === 'stars') return '#/speciali'
  if (r.name === 'meals') return '#/mangiato'
  if (r.name === 'search') return '#/cerca'
  if (r.name === 'countries') return '#/paesi'
  if (r.name === 'follow') return `#/segui/${r.code}`
  return '#/'
}

/**
 * TRANSIZIONI FRA LE PAGINE (richiesta dell'utente, 30/10/2026). Le pagine sono
 * disposte in fila: a sinistra della Home Paesi, Locali, Speciali e Cerca; a
 * destra i viaggi e le Impostazioni. Andando verso destra la pagina vecchia
 * scivola a sinistra e la nuova entra da destra; tornando, il contrario.
 * Con la View Transitions API (Safari 18+): dove manca, il cambio è immediato
 * come prima. Lo «swipe indietro» di iOS non passa di qui: resta il suo.
 */
const SIDE: Record<Route['name'], number> = { countries: -1, meals: -1, stars: -1, search: -1, home: 0, follow: 0, trip: 1, settings: 1 }
/** Pagine interne delle Impostazioni: un passo più a destra delle Impostazioni stesse. */
const place = (r: Route) => SIDE[r.name] + (r.name === 'settings' && r.page ? 0.5 : 0)

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
    void recolorTrips()
    void convertThumbs()
    void routesPending()
    startSync()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Ogni schermata si apre dall'inizio. Dopo il disegno: prima, la pagina
  // vecchia (più lunga) riporterebbe giù lo scorrimento.
  // ⚠️ Fra graffe: nei browser recenti scrollTo restituisce una Promise, e
  // React la prenderebbe per una funzione di pulizia (schermata bianca).
  // Non quando cambia solo la tappa aperta dentro lo stesso viaggio.
  const screenKey = route.name === 'trip' ? `trip:${route.id}` : route.name === 'settings' && route.page ? `settings:${route.page}` : route.name
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screenKey])

  const go = (r: Route) => {
    const from = place(route)
    const to = place(r)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!document.startViewTransition || from === to || reduce) {
      location.hash = writeRoute(r)
      return
    }
    document.documentElement.dataset.nav = to > from ? 'forward' : 'back'
    const t = document.startViewTransition(() => {
      // La pagina nuova va disegnata (e portata in cima) DENTRO la transizione,
      // perché l'istantanea «dopo» sia quella giusta.
      flushSync(() => setRoute(r))
      window.scrollTo(0, 0)
      history.pushState(null, '', writeRoute(r))
    })
    void t.finished.finally(() => delete document.documentElement.dataset.nav)
  }

  if (GUIDE !== null) return <InstallGate force={GUIDE} />

  return (
    <>
      <div className="statusbar-bg" />
      {/* Avanzamento e «Condividi» degli export, da qualsiasi schermata. */}
      <ExportSheet />
      {updateReady && (
        <div className="banner">
          <button className="btn" onClick={() => void applyUpdate()}>
            Nuova versione pronta · tocca per aggiornare
          </button>
        </div>
      )}
      {/* La chiave la ricrea a ogni schermata: cambiando pagina si riparte puliti. */}
      <ErrorBoundary key={screenKey}>
        {route.name === 'home' && <HomeScreen go={go} />}
        {route.name === 'follow' && <HomeScreen go={go} follow={route.code} />}
        {route.name === 'trip' && <TripScreen key={route.id} id={route.id} initialStop={route.stop} go={go} />}
        {route.name === 'settings' && <SettingsScreen page={route.page} go={go} />}
        {route.name === 'stars' && <StarsScreen go={go} />}
        {route.name === 'meals' && <MealsScreen go={go} />}
        {route.name === 'search' && <SearchScreen go={go} />}
        {route.name === 'countries' && <CountriesScreen go={go} />}
      </ErrorBoundary>
    </>
  )
}
