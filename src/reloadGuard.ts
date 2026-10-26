// Vive in sessionStorage e conta solo i ricaricamenti degli ultimi secondi.
const KEY = 'mytrip:reloads'
const WINDOW_MS = 15_000
const LIMIT = 4

/**
 * Rete di sicurezza contro i cicli di riavvio.
 *
 * L'aggiornamento automatico ricarica la pagina. Se per un guasto qualsiasi la
 * versione nuova continua a "riattivarsi", la pagina si ricaricherebbe
 * all'infinito e l'unica via d'uscita sembrerebbe disinstallare l'app, il che
 * CANCELLA TUTTI I VIAGGI. (In MyBsns è successo davvero, il 16/08/2026.)
 *
 * Oltre la soglia si toglie di mezzo il service worker e si smette di
 * ricaricare: l'app resta usabile, servita dalla rete, e i dati non si toccano.
 */
export function reloadLoopDetected(): boolean {
  let recent: number[] = []
  try {
    const stored = sessionStorage.getItem(KEY)
    recent = stored ? (JSON.parse(stored) as number[]) : []
  } catch {
    recent = []
  }

  const now = Date.now()
  recent = [...recent.filter((time) => now - time < WINDOW_MS), now]

  if (recent.length < LIMIT) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(recent))
    } catch {
      // Spazio di sessione non disponibile: si rinuncia al conteggio, non all'app.
    }
    return false
  }

  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignorata di proposito
  }
  void unregisterEverything()
  return true
}

/** Toglie service worker e cache. ⚠️ Non tocca IndexedDB: i viaggi restano. */
export async function unregisterEverything(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((r) => r.unregister().catch(() => false)))
  }
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}
