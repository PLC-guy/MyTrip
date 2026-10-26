import type { Route, Stop } from './db'
import { distanceM } from './importPhotos'
import type { MapLine } from './MapView'
import { transportOf } from './transport'
import { fmtDuration } from './format'

/**
 * TRATTI FRA LE TAPPE
 *
 * Il mezzo si può indicare a mano; se manca si deduce dalla distanza: sotto
 * WALK_KM a piedi, oltre in auto. ⚠️ Non sempre auto: in un centro storico il
 * percorso in auto gira attorno a sensi unici e ZTL e viene assurdo, a Venezia
 * non esiste proprio.
 *
 * Il percorso stimato viene da `routing.ts` ed è salvato in `db.routes`. Qui si
 * decide cosa disegnare e quando avvisare. Gli avvisi riguardano solo i tratti
 * col mezzo DEDOTTO: se l'hai scelto tu, l'app si fida.
 */
export const WALK_KM = 2
/** Oltre questo rapporto fra percorso e linea d'aria il percorso si considera un giro assurdo. */
const ABSURD_RATIO = 3
/** Margine sul tempo: in auto servono X minuti, tra le foto ne sono passati meno di X − margine. */
const TIME_MARGIN_MIN = 20
/** Ore di guida plausibili in 24 ore. */
const MAX_DRIVE_H = 10
/** Spostamento oltre il quale il percorso salvato non vale più. */
export const MOVE_TOLERANCE_M = 150

/** Mezzo → tipo di percorso del servizio. Taxi e auto condividono lo stesso percorso salvato. */
export function profileOf(mode: string): string | undefined {
  switch (mode) {
    case 'walk':
      return 'pedestrian'
    case 'bike':
      return 'bicycle'
    case 'scooter':
      return 'motor_scooter'
    case 'bus':
      return 'bus'
    case 'car':
    case 'taxi':
    case 'boat': // in auto, per scoprire se c'è un traghetto mappato
      return 'auto'
    default:
      return undefined // treno e aereo: niente percorso stimato
  }
}

export const routeId = (toStopId: string, profile: string) => `${toStopId}|${profile}`

type LegStop = Pick<Stop, 'id' | 'lat' | 'lon' | 'start' | 'end' | 'transport' | 'straight'>

/** Mezzo usato per il tratto: quello scelto, o quello dedotto dalla distanza. */
export function legMode(from: LegStop, to: LegStop): { mode: string; inferred: boolean } {
  if (to.transport) return { mode: to.transport, inferred: false }
  const km = distanceM(from.lat, from.lon, to.lat, to.lon) / 1000
  return { mode: km < WALK_KM ? 'walk' : 'car', inferred: true }
}

/** Il percorso salvato vale ancora? (le tappe non si sono spostate) */
export function routeIsFresh(r: Route, from: LegStop, to: LegStop): boolean {
  return distanceM(r.fromLat, r.fromLon, from.lat, from.lon) < MOVE_TOLERANCE_M && distanceM(r.toLat, r.toLon, to.lat, to.lon) < MOVE_TOLERANCE_M
}

export interface LegInfo {
  toStopId: string
  mode: string
  inferred: boolean
  /** Icona ed etichetta da mostrare (un traghetto trovato dal percorso vince sull'auto dedotta). */
  icon: string
  label: string
  /** Distanza da mostrare: sul percorso se c'è, altrimenti in linea d'aria. */
  km: number
  straightKm: number
  minutes?: number
  /** Percorso non ancora calcolato (serve la rete). */
  pending: boolean
  /** Disegnato in linea dritta (treno, barca senza tratta mappata, percorso non trovato…). */
  straight: boolean
  warning?: string
  points: [number, number][]
}

export function legInfo(from: LegStop, to: LegStop, routes: Map<string, Route>): LegInfo {
  const { mode, inferred } = legMode(from, to)
  const straightKm = distanceM(from.lat, from.lon, to.lat, to.lon) / 1000
  const t = transportOf(mode)
  const base: LegInfo = {
    toStopId: to.id,
    mode,
    inferred,
    icon: t?.icon ?? '•',
    label: t?.label ?? mode,
    km: straightKm,
    straightKm,
    pending: false,
    straight: true,
    points: [
      [from.lat, from.lon],
      [to.lat, to.lon],
    ],
  }

  if (mode === 'plane') return { ...base, straight: false, points: arc(from, to) }
  const profile = profileOf(mode)
  if (!profile) return base // treno

  const r = routes.get(routeId(to.id, profile))
  if (!r || !routeIsFresh(r, from, to)) return { ...base, pending: true }

  const what = mode === 'walk' ? 'a piedi' : 'in auto'
  if (r.status !== 'ok' || !r.coords) {
    return {
      ...base,
      warning: inferred ? (r.status === 'far' ? `Troppo lontano per esserci arrivato ${what}: indica il mezzo` : `Non si arriva ${what}: forse in barca o in aereo? Indica il mezzo`) : undefined,
    }
  }

  const absurd = straightKm > 1 && (r.km ?? 0) > straightKm * ABSURD_RATIO
  // Barca scelta a mano ma nessun traghetto sul percorso: la rotta vera non la conosciamo.
  if (mode === 'boat' && !r.ferry) return base
  if (absurd) return { ...base, warning: inferred ? `Il percorso ${what} stimato è un giro improbabile: indica il mezzo` : undefined }

  const info: LegInfo = { ...base, km: r.km ?? straightKm, minutes: r.minutes, straight: !!to.straight, points: to.straight ? base.points : r.coords }
  // Un traghetto trovato dal percorso dice più dell'auto dedotta.
  if (inferred && r.ferry && mode === 'car') Object.assign(info, { icon: '⛴️', label: 'Traghetto' })

  // In auto, il tempo di guida stimato deve stare nel tempo passato fra le foto
  // E in una giornata umana: al massimo MAX_DRIVE_H ogni 24 ore. Senza il
  // secondo limite, 21 ore di guida fra due foto a 23 ore di distanza
  // passerebbero (Chiang Mai → Phuket, 1589 km).
  const gapMin = (to.start - from.end) / 60_000
  if (inferred && mode === 'car' && r.minutes != null && gapMin > 0) {
    const days = Math.max(1, Math.ceil(gapMin / (24 * 60)))
    const tooFast = r.minutes - TIME_MARGIN_MIN > gapMin
    const tooLong = r.minutes > days * MAX_DRIVE_H * 60
    if (tooFast) info.warning = `In auto servono circa ${fmtDuration(r.minutes)}, tra le foto ne sono passati ${fmtDuration(gapMin)}: forse aereo o treno?`
    else if (tooLong) info.warning = `Sarebbero circa ${fmtDuration(r.minutes)} di guida in ${days === 1 ? 'un giorno' : `${days} giorni`}: forse aereo o treno?`
  }
  return info
}

/** Tutti i tratti di un viaggio, nell'ordine delle tappe. */
export function tripLegs(stops: LegStop[], routes: Map<string, Route>): LegInfo[] {
  const out: LegInfo[] = []
  for (let i = 1; i < stops.length; i++) out.push(legInfo(stops[i - 1], stops[i], routes))
  return out
}

/** Linee per la mappa; `upTo` limita ai primi tratti (itinerario animato). */
export function legsToLines(legs: LegInfo[], color: string, upTo = legs.length + 1): MapLine[] {
  return legs.slice(0, Math.max(0, upTo - 1)).map((l) => ({
    id: l.toStopId,
    color,
    points: l.points,
    flight: l.mode === 'plane',
    straight: l.straight && l.mode !== 'plane',
    icon: l.inferred && l.icon !== '⛴️' ? undefined : l.icon,
  }))
}

/** Arco di cerchio massimo, come le rotte dei voli sulle mappe. */
function arc(a: LegStop, b: LegStop, n = 48): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const [la1, lo1, la2, lo2] = [toRad(a.lat), toRad(a.lon), toRad(b.lat), toRad(b.lon)]
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2))
  if (d < 1e-6) return [[a.lat, a.lon], [b.lat, b.lon]]
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2)
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2)
    const z = A * Math.sin(la1) + B * Math.sin(la2)
    pts.push([toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))])
  }
  return pts
}
