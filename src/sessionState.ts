import { useState } from 'react'

/**
 * PREFERENZE DELLA SESSIONE (scelta dell'utente, 2/11/2026)
 *
 * Filtri e sezioni aperte o chiuse restano come li si lascia finché l'app è
 * aperta, anche in secondo piano e cambiando pagina. Chiusa e riaperta, l'app
 * riparte dalla configurazione standard. Per questo sessionStorage e non
 * localStorage: su iOS una nuova apertura dell'app è una sessione nuova.
 * ⚠️ Le preferenze vere (tema, colore dei paesi, il viaggiatore, tappe) restano
 * in localStorage: quelle non si azzerano.
 *
 * `valid` scarta un valore salvato che non ha più senso (per esempio un filtro
 * che non esiste più): si torna a `initial`.
 */
export function useSessionState<T>(key: string, initial: T, valid: (v: unknown) => v is T = (v): v is T => typeof v === typeof initial) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key)
      if (saved != null) {
        const v: unknown = JSON.parse(saved)
        if (valid(v)) return v
      }
    } catch {
      // Valore illeggibile o memoria non disponibile: si parte da quello standard.
    }
    return initial
  })
  const set = (v: T) => {
    setValue(v)
    try {
      sessionStorage.setItem(key, JSON.stringify(v))
    } catch {
      // Senza memoria del browser vale solo per questa pagina.
    }
  }
  return [value, set] as const
}
