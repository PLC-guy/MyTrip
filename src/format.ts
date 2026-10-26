/**
 * Date e ore si mostrano SEMPRE nell'ora locale del luogo dello scatto, cioè
 * come stringa EXIF ("2026-09-26T18:18:45"). Per formattarla senza che il fuso
 * del dispositivo la sposti, la si legge come UTC e la si stampa in UTC.
 */
/**
 * ⚠️ Accetta anche un giorno senza ora ("2026-02-10"). Safari considera non
 * valida la stringa "2026-02-10Z" (Chrome no), e formattare una data non valida
 * lancia un errore che lasciava la schermata del viaggio vuota (0.4.0 su iPhone).
 */
const asDate = (local: string) => new Date((local.length === 10 ? local + 'T00:00:00' : local) + 'Z')

const DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DAY_LONG = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const SHORT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const SHORT_Y = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export const fmtDay = (local: string) => DAY.format(asDate(local))
export const fmtDayLong = (local: string) => DAY_LONG.format(asDate(local))
export const fmtTime = (local: string) => TIME.format(asDate(local))
export const fmtDateTime = (local: string) => `${fmtDay(local)} · ${fmtTime(local)}`

/** Giorno di calendario dello scatto, "2026-09-26". */
export const dayOf = (local: string) => local.slice(0, 10)

/** «12–28 ago 2026», «28 ago – 3 set 2026», «30 dic 2025 – 4 gen 2026». */
export function fmtRange(from: string, to: string): string {
  const a = asDate(from)
  const b = asDate(to)
  if (dayOf(from) === dayOf(to)) return SHORT_Y.format(a)
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${SHORT_Y.format(a)} – ${SHORT_Y.format(b)}`
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${SHORT_Y.format(b)}`
  return `${SHORT.format(a)} – ${SHORT_Y.format(b)}`
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** «45 min», «3 h 05». */
export const fmtDuration = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`)
