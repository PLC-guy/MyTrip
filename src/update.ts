import { registerSW } from 'virtual:pwa-register'
import { unregisterEverything } from './reloadGuard'
import { sheetsOpen } from './Sheet'

/**
 * AGGIORNAMENTO AUTOMATICO
 *
 * Obiettivo: non dover mai cancellare e reinstallare l'app (cancellarla
 * cancella i viaggi). Ogni versione pubblicata arriva da sola.
 *
 * Quando c'è una versione nuova si applica SOLO in un momento sicuro, perché
 * applicarla vuol dire ricaricare la pagina:
 *  - nei primi secondi dopo l'apertura, prima che si inizi a usare l'app;
 *  - al rientro dell'app in primo piano (sullo schermo c'era altro);
 *  - mai durante un import di foto: si aspetta che finisca;
 *  - mai con un foglio aperto (revisione di robustezza R4, 2/11/2026): diario,
 *    nota della tappa, scelta delle foto, ripristino. Si scrive il diario, si
 *    passa a Foto e si torna: la ricarica faceva sparire il testo non salvato.
 * Fuori da questi momenti compare solo un avviso da toccare, per non far
 * sparire a metà una nota che si sta scrivendo.
 *
 * ⚠️ Il browser cerca versioni nuove solo quando si naviga, e una PWA aperta
 * per giorni non naviga mai: il controllo si chiede a mano all'avvio, al
 * rientro in primo piano e ogni ora.
 */

const AVVIO_MS = 12_000
const INTERVALLO_MS = 60 * 60 * 1000
const ATTESA_MS = 4000

const startedAt = Date.now()
let pending = false
let busy = false
let showBanner: () => void = () => {}

/** Durante un import l'app non deve ricaricarsi. */
export function setBusy(value: boolean): void {
  busy = value
  if (!busy && pending) showBanner()
}

function tryApply(momento: 'arrivo' | 'rientro'): void {
  if (busy) return
  if (sheetsOpen() > 0) {
    showBanner()
    return
  }
  if (momento === 'rientro' || Date.now() - startedAt < AVVIO_MS) void applyUpdate()
  else showBanner()
}

export function startAutoUpdate(onBanner: () => void): void {
  showBanner = onBanner
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true
      tryApply('arrivo')
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // Senza rete il controllo fallisce: si riproverà al rientro successivo.
      const check = () => void registration.update().catch(() => {})
      check()
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return
        if (pending) tryApply('rientro')
        else check()
      })
      window.setInterval(check, INTERVALLO_MS)
    },
  })
}

/**
 * Attiva la versione in attesa e ricarica.
 *
 * Si parla direttamente col service worker: gli si chiede di prendere il posto
 * del vecchio e si ricarica quando il passaggio è avvenuto. Se entro pochi
 * secondi non succede (capita su iOS) si toglie di mezzo il worker e si
 * ricarica dalla rete. I viaggi, in IndexedDB, non si toccano in nessun caso.
 */
export async function applyUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    location.reload()
    return
  }
  const registration = await navigator.serviceWorker.getRegistration()
  const waiting = registration?.waiting
  if (!waiting) {
    await forceUpdate()
    return
  }

  let done = false
  const reload = () => {
    if (done) return
    done = true
    location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
  window.setTimeout(() => {
    if (done) return
    done = true
    // ⚠️ Senza rete NON si riparte dalla rete (revisione di robustezza R5): la
    // pagina non si caricherebbe più finché la rete non torna. Resta la
    // versione di adesso, si riprova al prossimo rientro.
    if (!navigator.onLine) {
      showBanner()
      return
    }
    void forceUpdate()
  }, ATTESA_MS)
}

/**
 * Riparte dalla rete con l'ultima versione pubblicata.
 * ⚠️ Prima si deregistra il worker, POI si svuotano le cache: al contrario il
 * worker resterebbe vivo su una cache vuota e potrebbe innescare un ciclo.
 */
export async function forceUpdate(): Promise<void> {
  await unregisterEverything()
  location.reload()
}

/**
 * «Cerca aggiornamenti» in Impostazioni (richiesta dell'utente, 2/11/2026: il
 * vecchio «Ricarica l'ultima versione» ripartiva sempre, senza dire niente, e
 * riscaricava tutta l'app anche quando era già aggiornata).
 * Chiede al service worker se c'è una versione nuova e aspetta che si scarichi:
 * 'nuova' → la si applica con `applyUpdate`; 'aggiornata' → niente da fare.
 */
export type UpdateCheck = 'nuova' | 'aggiornata' | 'offline' | 'errore'
const UPDATED_KEY = 'mytrip:updated-from'

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!navigator.onLine) return 'offline'
  if (!('serviceWorker' in navigator)) return 'aggiornata'
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return 'aggiornata'
    if (registration.waiting) return 'nuova'
    await registration.update()
    const worker = registration.installing
    if (!worker) return registration.waiting ? 'nuova' : 'aggiornata'
    // Si aspetta che la versione nuova finisca di scaricarsi (al massimo 60 s).
    const ok = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 60_000)
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') { window.clearTimeout(timer); resolve(true) }
        if (worker.state === 'redundant') { window.clearTimeout(timer); resolve(false) }
      })
    })
    return ok ? 'nuova' : 'errore'
  } catch {
    return 'errore'
  }
}

/** Applica la versione trovata e ricorda da quale si partiva, per dirlo dopo il ricaricamento. */
export function installUpdate(): void {
  try {
    sessionStorage.setItem(UPDATED_KEY, __VERSION__)
  } catch {
    // Senza memoria: dopo il ricaricamento non si dirà «aggiornata».
  }
  void applyUpdate()
}

/** Dopo un aggiornamento chiesto in Impostazioni: la versione di prima, una volta sola. */
export function takeUpdatedFrom(): string | undefined {
  try {
    const from = sessionStorage.getItem(UPDATED_KEY) ?? undefined
    sessionStorage.removeItem(UPDATED_KEY)
    return from && from !== __VERSION__ ? from : undefined
  } catch {
    return undefined
  }
}

export const versionLabel = () => `${__VERSION__} · ${__COMMIT__}`

const BUILT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const buildLabel = () => BUILT.format(new Date(__BUILD_TIME__))
