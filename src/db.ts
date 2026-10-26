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
  country?: string
  /** true quando il nome del luogo è già stato chiesto (anche se non trovato). */
  geocoded?: boolean
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
