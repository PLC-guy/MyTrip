import { useSyncExternalStore } from 'react'

/**
 * IL VIAGGIATORE (Impostazioni › Il viaggiatore, richiesta dell'utente del
 * 30/10/2026)
 *
 * Il nome scelto da chi usa l'app. Serve a chi segue i suoi viaggi condivisi:
 * sulla scheda compare «Viaggio di Alex». Va al server solo dentro l'indice del
 * viaggio condiviso, quindi CIFRATO con la chiave del link (sync.ts); per i
 * viaggi non condivisi non esce dal telefono.
 *
 * In localStorage, come le preferenze d'aspetto: è un dato di questo dispositivo.
 */
const KEY = 'mytrip:profile'
const MAX = 40

export interface Profile {
  name?: string
}

function read(): Profile {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Profile
  } catch {
    return {}
  }
}

let current = read()
const listeners = new Set<() => void>()

export function getProfile(): Profile {
  return current
}

export function setProfile(next: Profile): void {
  const name = next.name?.trim().slice(0, MAX) || undefined
  current = { name }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Spazio non disponibile: vale per questa apertura.
  }
  for (const l of listeners) l()
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
