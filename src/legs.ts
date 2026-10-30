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
/**
 * Giro assurdo: percorso oltre ABSURD_RATIO volte la linea d'aria E più lungo di
 * ABSURD_EXTRA_KM. Serve per le foto scattate in mare o vicino a un'altra isola,
 * dove il servizio inventa giri di decine di km (rapporti 10–20×).
 * ⚠️ Non meno: con 3× e nessun minimo (0.6.0) risultavano «improbabili» strade
 * di montagna e del deserto del tutto normali, piene di tornanti o costrette a
 * girare attorno ai rilievi (Tenerife 3,0× e 3,5×, Las Vegas 3,3×; 27/10/2026).
 */
const ABSURD_RATIO = 5
const ABSURD_EXTRA_KM = 25
/** Oltre questo rapporto il giro è assurdo anche se i km in più sono pochi (un sentiero di 1,9 km stimato 25 km). */
const ABSURD_RATIO_ALWAYS = 8
/**
 * Percorso che non parte o non arriva alla tappa. Il servizio «aggancia» ogni
 * tappa alla strada o al sentiero mappato più vicino: in montagna, dove i
 * sentieri spesso mancano, l'aggancio finiva a 2–4 km e l'itinerario risultava a
 * pezzi, con linee lontane dalle tappe (viaggio «Test» in montagna, 28/10/2026).
 * Aggancio oltre SNAP_MAX_M (o oltre SNAP_MAX_SHARE della linea d'aria, per i
 * tratti lunghi) = percorso non valido, si disegna la linea dritta.
 * ⚠️ 30% e non 10%: in Gran Canaria (30/10/2026) un tratto in auto di 22 km con
 * la tappa a 2,7 km dalla strada (12%) finiva in linea dritta pur avendo la
 * strada. I casi di montagna da scartare avevano agganci più lunghi del tratto
 * stesso (100–140%): restano scartati.
 */
const SNAP_MAX_M = 300
const SNAP_MAX_SHARE = 0.3
/** Un percorso vero non è più corto della linea d'aria: se lo è, l'aggancio ha tagliato il tratto. */
const MIN_ROUTE_SHARE = 0.7
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

  // Percorso agganciato lontano dalle tappe, o più corto della linea d'aria:
  // non descrive il tratto. Linea dritta, senza avviso: un sentiero non mappato
  // è normale, e la tappa resta collegata. ⚠️ L'itinerario deve essere sempre
  // completo e in ordine: meglio una linea dritta che un pezzo staccato.
  const snapMax = Math.max(SNAP_MAX_M, straightKm * 1000 * SNAP_MAX_SHARE)
  const [first, last] = [r.coords[0], r.coords[r.coords.length - 1]]
  const snapped = distanceM(from.lat, from.lon, first[0], first[1]) > snapMax || distanceM(to.lat, to.lon, last[0], last[1]) > snapMax
  if (snapped || (r.km ?? 0) < straightKm * MIN_ROUTE_SHARE) return base

  const ratio = (r.km ?? 0) / Math.max(straightKm, 0.001)
  const absurd = ratio > ABSURD_RATIO_ALWAYS || (ratio > ABSURD_RATIO && (r.km ?? 0) - straightKm > ABSURD_EXTRA_KM)
  // Barca scelta a mano ma nessun traghetto sul percorso: la rotta vera non la conosciamo.
  if (mode === 'boat' && !r.ferry) return base
  if (absurd) return { ...base, warning: inferred ? `Il percorso ${what} stimato è un giro improbabile: indica il mezzo` : undefined }

  // Il percorso parte e arriva sempre nel punto esatto delle tappe (l'aggancio
  // alla strada lascerebbe qualche metro di vuoto attorno ai pallini).
  const route: [number, number][] = [[from.lat, from.lon], ...r.coords, [to.lat, to.lon]]
  const info: LegInfo = { ...base, km: r.km ?? straightKm, minutes: r.minutes, straight: !!to.straight, points: to.straight ? base.points : route }
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
    // Nessuna icona del mezzo sulla mappa, nemmeno se scelto a mano (richiesta
    // dell'utente, 27/10/2026): il mezzo si legge nella cronologia.
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
