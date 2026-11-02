import { readEnvironment } from './install'
import { SYNC_URL } from './sync'

/**
 * CONTEGGIO DELLE APP IN USO (richiesta dell'utente, 2/11/2026, fase di prova)
 *
 * Una volta al giorno l'app manda al server un segnale anonimo per farsi
 * contare: un codice casuale nato su questo telefono (non dice niente di chi lo
 * usa), la versione, se è installata o aperta nel browser e il sistema. Nessun
 * dato dei viaggi, nessun nome, nessuna posizione. Il server conta i codici
 * diversi (pagina di stato in `server/worker.js`).
 *
 * ⚠️ Solo nella versione pubblicata: in sviluppo e nelle prove su localhost no,
 * per non contare i telefoni finti. Se fallisce non importa: si riprova al
 * prossimo avvio.
 */
const KEY = 'mytrip:conta'

export function countMe(): void {
  if (!import.meta.env.PROD || location.hostname === 'localhost') return
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { i?: string; day?: string }
    const day = new Date().toISOString().slice(0, 10)
    if (saved.day === day) return
    const i = saved.i ?? crypto.randomUUID()
    const env = readEnvironment()
    const body = JSON.stringify({ i, v: __VERSION__, m: env.installed ? 'app' : 'browser', o: env.platform })
    // Testo semplice: niente richiesta preliminare del browser (CORS).
    fetch(`${SYNC_URL}/ping`, { method: 'POST', body, keepalive: true })
      .then((r) => {
        if (r.ok) localStorage.setItem(KEY, JSON.stringify({ i, day }))
      })
      .catch(() => {})
  } catch {
    // ignorata di proposito: è solo un conteggio
  }
}
