import Dexie, { type EntityTable } from 'dexie'
import { forgetThumbs } from './thumbUrl'

/**
 * Archivio locale (IndexedDB).
 *
 * ⚠️ Il nome del database `mytrip` e i nomi dei campi NON si rinominano: sono
 * scritti dentro i viaggi già salvati e dentro i file esportati. Per aggiungere
 * un indice si crea una versione nuova dello schema, non si modifica questa.
 *
 * Tutti gli id sono UUID: un viaggio reimportato (anche su un altro dispositivo)
 * si riconosce e si aggiorna invece di duplicarsi.
 */

export interface Trip {
  id: string
  name: string
  createdAt: number
  /** Colore del viaggio sulla mappa generale. */
  color: string
  /**
   * Copertina scelta a mano: una foto qualsiasi dell'app, anche di un altro
   * viaggio. Se manca (o la foto è stata tolta) si usa la prima del viaggio.
   */
  coverPhotoId?: string
  /** Oppure un'immagine caricata solo per la copertina: non è una tappa. */
  coverImage?: Blob
  /** Cambia a ogni nuova immagine di copertina: serve a non mostrare quella vecchia. */
  coverImageId?: string
  /** Diario: un testo per giorno, chiave "2026-09-26". */
  diary?: Record<string, string>
  /** Tipo di viaggio scelto da chi lo crea; se manca vale «piacere». ⚠️ Valori da non rinominare. */
  kind?: TripKind
}

export type TripKind = 'piacere' | 'lavoro'
export const TRIP_KINDS: { key: TripKind; label: string; icon: string }[] = [
  { key: 'piacere', label: 'Piacere', icon: '🌴' },
  { key: 'lavoro', label: 'Lavoro', icon: '💼' },
]

/** Meteo all'ora della prima foto della tappa (codici WMO di Open-Meteo). */
export interface Weather {
  temp: number
  code: number
}

/** Una tappa: foto vicine nello spazio e nel tempo. */
export interface Stop {
  id: string
  tripId: string
  /** Centro della tappa: media delle posizioni delle sue foto. */
  lat: number
  lon: number
  /** Istante della prima e dell'ultima foto (per ordinare e raggruppare). */
  start: number
  end: number
  /** Data e ora locali della prima foto, nel luogo dello scatto: "2026-09-26T18:18:45". */
  first: string
  /** Nome del luogo da OpenStreetMap, es. «Bologna». */
  place?: string
  /** Nome scelto a mano: ha la precedenza e il nome automatico non lo tocca mai. */
  name?: string
  country?: string
  /** Codice ISO del paese, «IT», «TH»: serve alla mappa dei paesi visitati. */
  countryCode?: string
  weather?: Weather
  /** true quando il meteo è già stato chiesto (anche se non trovato). */
  weatherDone?: boolean
  /** Mezzo con cui si è arrivati qui dalla tappa precedente (chiave di transport.ts). */
  transport?: string
  /** true quando il nome del luogo è già stato chiesto (anche se non trovato). */
  geocoded?: boolean
  /** Versione delle regole con cui il nome è stato chiesto (vedi geocode.ts). */
  geoV?: number
  note?: string
  star?: boolean
}

export interface Photo {
  id: string
  tripId: string
  stopId: string
  /** Impronta dello scatto (data + posizione): riconosce la stessa foto importata due volte. */
  key: string
  /** Data e ora locali nel luogo dello scatto, "2026-09-26T18:18:45". */
  taken: string
  /** Fuso dello scatto se la foto lo dichiara, es. "+02:00". */
  offset?: string
  /** Istante per ordinare: reale se c'è il fuso, altrimenti l'ora locale letta come UTC. */
  time: number
  lat: number
  lon: number
  /** Altitudine in metri, se la foto la dichiara (le foto importate prima della 0.4.0 non ce l'hanno). */
  alt?: number
  /** Miniatura JPEG: l'originale resta nella galleria del telefono. */
  thumb: Blob
  width: number
  height: number
  /** Nome del file originale, per ritrovarlo. */
  name: string
}

export const db = new Dexie('mytrip') as Dexie & {
  trips: EntityTable<Trip, 'id'>
  stops: EntityTable<Stop, 'id'>
  photos: EntityTable<Photo, 'id'>
}

db.version(1).stores({
  trips: 'id, createdAt',
  stops: 'id, tripId, start',
  photos: 'id, tripId, stopId, key, [tripId+time]',
})

/** Colori assegnati ai viaggi, a rotazione. */
export const TRIP_COLORS = ['#E07A5F', '#3D8B85', '#8E6CB4', '#D4A03A', '#4A7BB7', '#C2577A', '#6A994E']

export function newId(): string {
  return crypto.randomUUID()
}

/** Cancella un viaggio con tutte le sue tappe e foto. */
export async function deleteTrip(tripId: string): Promise<void> {
  const trip = await db.trips.get(tripId)
  forgetThumbs([...(await db.photos.where('tripId').equals(tripId).primaryKeys()), ...(trip?.coverImageId ? [trip.coverImageId] : [])])
  await db.transaction('rw', db.trips, db.stops, db.photos, async () => {
    await db.photos.where('tripId').equals(tripId).delete()
    await db.stops.where('tripId').equals(tripId).delete()
    await db.trips.delete(tripId)
  })
}

/** Cancella una foto; la tappa si ricalcola, o sparisce se resta vuota. */
export async function deletePhoto(photoId: string): Promise<void> {
  forgetThumbs([photoId])
  await db.transaction('rw', db.stops, db.photos, async () => {
    const photo = await db.photos.get(photoId)
    if (!photo) return
    await db.photos.delete(photoId)
    const rest = await db.photos.where('stopId').equals(photo.stopId).toArray()
    if (rest.length === 0) {
      await db.stops.delete(photo.stopId)
      return
    }
    await db.stops.update(photo.stopId, stopSummary(rest))
  })
}

/** Nome da mostrare: quello scelto a mano, poi quello automatico. */
export function stopTitle(s: Stop): string {
  return s.name ?? s.place ?? (s.geocoded ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : 'Cerco il nome del luogo…')
}

/**
 * Unisce la tappa `fromId` in `intoId`: foto, note e stellina passano alla
 * seconda, la prima sparisce. Il nome scelto a mano di `intoId` resta.
 */
export async function mergeStops(intoId: string, fromId: string): Promise<void> {
  await db.transaction('rw', db.stops, db.photos, async () => {
    const into = await db.stops.get(intoId)
    const from = await db.stops.get(fromId)
    if (!into || !from) return
    await db.photos.where('stopId').equals(fromId).modify({ stopId: intoId })
    const photos = await db.photos.where('stopId').equals(intoId).toArray()
    const note = [into.note, from.note].filter(Boolean).join('\n') || undefined
    const summary = stopSummary(photos)
    // Se la tappa ora comincia prima, l'arrivo è quello dell'altra tappa (mezzo
    // compreso) e il meteo va richiesto per la nuova ora.
    const startsEarlier = summary.first !== into.first
    await db.stops.update(intoId, {
      ...summary,
      note,
      star: into.star || from.star || undefined,
      name: into.name ?? from.name,
      ...(startsEarlier ? { transport: from.transport, weather: undefined, weatherDone: undefined } : {}),
    })
    await db.stops.delete(fromId)
  })
}

/**
 * Divide una tappa: la foto indicata e quelle scattate dopo formano una tappa
 * nuova, con nome e meteo da chiedere di nuovo. Restituisce l'id della nuova.
 */
export async function splitStop(stopId: string, fromPhotoId: string): Promise<string | undefined> {
  return db.transaction('rw', db.stops, db.photos, async () => {
    const stop = await db.stops.get(stopId)
    const photos = (await db.photos.where('stopId').equals(stopId).toArray()).sort((a, b) => a.time - b.time)
    const at = photos.findIndex((p) => p.id === fromPhotoId)
    if (!stop || at <= 0) return undefined
    const before = photos.slice(0, at)
    const after = photos.slice(at)
    const id = newId()
    await db.stops.add({ id, tripId: stop.tripId, ...stopSummary(after) })
    await db.photos.where('id').anyOf(after.map((p) => p.id)).modify({ stopId: id })
    await db.stops.update(stopId, stopSummary(before))
    return id
  })
}

/** Centro e intervallo di tempo di una tappa, dalle sue foto. */
export function stopSummary(photos: Pick<Photo, 'lat' | 'lon' | 'time' | 'taken'>[]) {
  const sorted = [...photos].sort((a, b) => a.time - b.time)
  return {
    lat: sorted.reduce((s, p) => s + p.lat, 0) / sorted.length,
    lon: sorted.reduce((s, p) => s + p.lon, 0) / sorted.length,
    start: sorted[0].time,
    end: sorted[sorted.length - 1].time,
    first: sorted[0].taken,
  }
}
