import { useSyncExternalStore } from 'react'

/**
 * RAGGRUPPAMENTO DELLE FOTO IN TAPPE (Impostazioni › Tappe, richiesta
 * dell'utente del 1/11/2026)
 *
 * Una foto nuova entra in una tappa esistente se è stata scattata entro
 * `radiusM` metri dal centro della tappa E a non più di `gapMin` minuti dalla
 * sua prima o ultima foto; altrimenti apre una tappa nuova (importPhotos.ts).
 *
 * ⚠️ Vale solo per le foto importate DOPO averli cambiati: le tappe già fatte
 * non si ricalcolano (unire e dividere a mano, note e locali andrebbero persi).
 *
 * In localStorage del dispositivo, e nel backup completo (backup.ts), così un
 * telefono ripristinato raggruppa come prima.
 */
const KEY = 'mytrip:grouping'

export interface Grouping {
  radiusM: number
  gapMin: number
}

/** Valori di partenza, decisi il 26/10/2026. */
export const DEFAULT_GROUPING: Grouping = { radiusM: 150, gapMin: 60 }
export const RADIUS_LIMITS = { min: 25, max: 2000 }
export const GAP_LIMITS = { min: 5, max: 24 * 60 }

const clamp = (v: unknown, l: { min: number; max: number }, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(l.max, Math.max(l.min, Math.round(v))) : d)

/** Valori validi da qualunque cosa (un backup vecchio, una casella vuota). */
export function cleanGrouping(g: Partial<Grouping> | undefined): Grouping {
  return { radiusM: clamp(g?.radiusM, RADIUS_LIMITS, DEFAULT_GROUPING.radiusM), gapMin: clamp(g?.gapMin, GAP_LIMITS, DEFAULT_GROUPING.gapMin) }
}

function read(): Grouping {
  try {
    return cleanGrouping(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Grouping>)
  } catch {
    return DEFAULT_GROUPING
  }
}

let current = read()
const listeners = new Set<() => void>()

export function getGrouping(): Grouping {
  return current
}

export function setGrouping(g: Partial<Grouping>): void {
  current = cleanGrouping(g)
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Spazio non disponibile: vale per questa apertura.
  }
  for (const l of listeners) l()
}

export function useGrouping(): Grouping {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
