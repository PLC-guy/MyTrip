import { useSyncExternalStore } from 'react'

/**
 * CONDIVISIONE DEI FILE ESPORTATI (viaggi, backup, KML)
 *
 * ⚠️ Perché i viaggi grandi non si riuscivano a condividere (30/10/2026, il
 * Vietnam non arrivava né su WhatsApp né su iCloud): Safari apre il foglio di
 * condivisione solo SUBITO dopo un tocco. Preparare un file di decine di MB
 * (ogni foto ~135 KB nel file) richiede secondi: finito, il permesso del tocco
 * era scaduto, `navigator.share` veniva rifiutato e l'app ripiegava su un
 * download che nell'app installata non fa nulla. Nessun errore, nessun file.
 *
 * Ora:
 * 1. mentre si prepara il file compare un foglio con l'avanzamento;
 * 2. se è stato veloce si condivide subito, come prima (un tocco solo);
 * 3. altrimenti il foglio dice «Il file è pronto» con «Condividi»: quel tocco
 *    è nuovo e il foglio di iOS si apre sempre.
 * Sul computer (niente condivisione di file) si scarica, come prima.
 */
export type Progress = (done: number, total: number) => void

type State =
  | { phase: 'idle' }
  | { phase: 'preparing'; label: string; done: number; total: number }
  | { phase: 'ready'; label: string; file: File }

/** Entro questo tempo dal tocco si prova a condividere subito. */
const QUICK_MS = 600

let state: State = { phase: 'idle' }
const listeners = new Set<() => void>()
let settle: ((shared: boolean) => void) | undefined

function set(next: State): void {
  state = next
  for (const l of listeners) l()
}

export function useExportState(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

type Outcome = 'shared' | 'cancelled' | 'blocked'

async function tryShare(file: File): Promise<Outcome> {
  try {
    await navigator.share({ files: [file] })
    return 'shared'
  } catch (e) {
    // Annullato da chi usa l'app: non è un errore. Rifiutato = il tocco è scaduto.
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    return 'blocked'
  }
}

/**
 * Prepara un file e lo consegna. `true` se è stato condiviso o scaricato,
 * `false` se annullato (serve al promemoria di backup).
 */
export async function shareExport(label: string, make: (onProgress: Progress) => Promise<File>): Promise<boolean> {
  const started = performance.now()
  set({ phase: 'preparing', label, done: 0, total: 0 })
  let file: File
  try {
    file = await make((done, total) => set({ phase: 'preparing', label, done, total }))
  } catch (e) {
    set({ phase: 'idle' })
    throw e
  }
  if (!navigator.canShare?.({ files: [file] })) {
    set({ phase: 'idle' })
    download(file)
    return true
  }
  if (performance.now() - started < QUICK_MS) {
    set({ phase: 'idle' })
    const r = await tryShare(file)
    if (r !== 'blocked') return r === 'shared'
  }
  set({ phase: 'ready', label, file })
  return new Promise((resolve) => (settle = resolve))
}

/** Dal pulsante «Condividi» del foglio: un tocco nuovo, quindi iOS lo accetta. */
export async function shareReady(): Promise<void> {
  if (state.phase !== 'ready') return
  const r = await tryShare(state.file)
  if (r === 'cancelled') return // il foglio resta: si può riprovare o chiudere
  set({ phase: 'idle' })
  settle?.(r === 'shared')
  settle = undefined
}

export function cancelReady(): void {
  set({ phase: 'idle' })
  settle?.(false)
  settle = undefined
}
