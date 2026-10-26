import type { Photo } from './db'

/**
 * Indirizzi delle miniature, uno per foto e creati una volta sola: Dexie
 * restituisce un Blob nuovo a ogni lettura, e crearne uno a ogni disegno
 * riempirebbe la memoria di copie.
 */
const cache = new Map<string, string>()

export function thumbUrl(photo: Pick<Photo, 'id' | 'thumb'>): string {
  let url = cache.get(photo.id)
  if (!url) {
    url = URL.createObjectURL(photo.thumb)
    cache.set(photo.id, url)
  }
  return url
}
