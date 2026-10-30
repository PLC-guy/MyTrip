import { useSyncExternalStore } from 'react'
import { db } from './db'
import { exportBackup } from './backup'
import { shareExport } from './exportFlow'

/**
 * PROMEMORIA DI BACKUP
 *
 * I viaggi esistono solo su questo telefono: se l'app si cancella o il telefono
 * si rompe, senza un backup recente si perde tutto. La Home ricorda di farlo:
 * - mai fatto, con almeno una foto;
 * - ultimo backup da REMIND_DAYS giorni o più;
 * - prima, se dall'ultimo backup sono arrivate NEW_PHOTOS foto o più (un viaggio
 *   appena importato vale la pena di salvarlo subito).
 * «Più tardi» lo nasconde per SNOOZE_DAYS giorni.
 *
 * Lo stato sta in localStorage: riguarda questo dispositivo, e se l'app si
 * cancella sparisce insieme ai viaggi, giustamente. Conta solo il backup
 * COMPLETO consegnato davvero (condivisione annullata = non fatto).
 * Struttura ripresa da `backupReminder.ts` di MyBsns.
 */
const KEY = 'mytrip:backup'
export const REMIND_DAYS = 30
const NEW_PHOTOS = 30
const SNOOZE_DAYS = 7

interface BackupState {
  /** Ultimo backup completo consegnato (ISO). */
  at?: string
  /** Foto in archivio in quel momento. */
  photos?: number
  /** «Più tardi» fino a questo momento (ISO). */
  snoozeUntil?: string
}

function read(): BackupState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as BackupState
  } catch {
    return {}
  }
}

let current = read()
const listeners = new Set<() => void>()

function write(next: BackupState): void {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Spazio non disponibile: vale per questa apertura.
  }
  for (const l of listeners) l()
}

export function useBackupState(): BackupState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** Giorni di calendario dall'ultimo backup; undefined = mai fatto. */
export function backupAgeDays(state: BackupState, now = new Date()): number | undefined {
  if (!state.at) return undefined
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((day(now) - day(new Date(state.at))) / 86_400_000)
}

export function describeBackupAge(state: BackupState): string {
  const age = backupAgeDays(state)
  if (age === undefined) return 'mai fatto'
  if (age <= 0) return 'oggi'
  if (age === 1) return 'ieri'
  return `${age} giorni fa`
}

/**
 * Foto che esistono solo su questo telefono, quelle che il promemoria conta:
 * tutte, meno quelle dei viaggi seguiti ancora condivisi (si riscaricano dal
 * server). Un viaggio seguito di cui chi viaggia ha smesso la condivisione
 * (`Share.ended`) torna a contare: da lì in poi, senza backup, si perderebbe
 * (osservazione dell'utente, 30/10/2026).
 */
export async function photosToKeep(): Promise<number> {
  const live = (await db.shares.where('role').equals('follow').toArray()).filter((s) => !s.ended)
  let n = await db.photos.count()
  for (const s of live) n -= await db.photos.where('tripId').equals(s.tripId).count()
  return n
}

export function backupDue(state: BackupState, photos: number, now = new Date()): boolean {
  if (photos === 0) return false
  if (state.snoozeUntil && new Date(state.snoozeUntil) > now) return false
  const age = backupAgeDays(state, now)
  if (age === undefined) return true
  return age >= REMIND_DAYS || photos - (state.photos ?? 0) >= NEW_PHOTOS
}

export function snoozeBackup(): void {
  write({ ...current, snoozeUntil: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString() })
}

/** Esporta tutti i viaggi; se il file è stato consegnato, il backup risulta fatto. */
export async function runBackup(): Promise<boolean> {
  const photos = await photosToKeep()
  const delivered = await shareExport('Backup completo', exportBackup)
  if (delivered) write({ at: new Date().toISOString(), photos })
  return delivered
}
