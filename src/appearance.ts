import { useSyncExternalStore } from 'react'

/**
 * Preferenze d'aspetto, scelte in Impostazioni › Aspetto.
 *
 * Vivono in localStorage: sono preferenze di questo dispositivo, non dati dei
 * viaggi, e non finiscono negli export. Se lo spazio non è disponibile (Safari
 * in navigazione privata) si usa il valore predefinito, senza errori.
 */
const KEY = 'mytrip:countryColor'

/** Colore predefinito dei paesi visitati: il verde tè del sito di Greta. */
export const DEFAULT_COUNTRY_COLOR = '#2F6B4F'
/** Proposte rapide: la palette del sito. */
export const COUNTRY_COLORS = ['#2F6B4F', '#1F4E8C', '#A3432A', '#E3A02B', '#6B4F8C', '#2F8C86', '#1C2B24']

const listeners = new Set<() => void>()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_COUNTRY_COLOR
  } catch {
    return DEFAULT_COUNTRY_COLOR
  }
}

export function setCountryColor(color: string): void {
  try {
    localStorage.setItem(KEY, color)
  } catch {
    // Spazio non disponibile: il colore vale solo per questa apertura.
  }
  current = color
  for (const l of listeners) l()
}

let current = read()

export function useCountryColor(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
