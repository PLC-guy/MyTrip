/**
 * Indirizzi delle miniature, uno per immagine e creati una volta sola: Dexie
 * restituisce un Blob nuovo a ogni lettura, e crearne uno a ogni disegno
 * riempirebbe la memoria di copie.
 *
 * ⚠️ Quando un'immagine viene cancellata o sostituita va DIMENTICATA con
 * `forgetThumbs`. Safari conserva i Blob di IndexedDB come file: cancellato il
 * record, l'indirizzo vecchio punta al vuoto. Un viaggio cancellato e poi
 * reimportato ha gli stessi id e, senza questo, mostrerebbe miniature vuote.
 */
const cache = new Map<string, string>()

export function thumbUrl(item: { id: string; thumb: Blob }): string {
  let url = cache.get(item.id)
  if (!url) {
    url = URL.createObjectURL(item.thumb)
    cache.set(item.id, url)
  }
  return url
}

export function forgetThumbs(ids: Iterable<string>): void {
  for (const id of ids) {
    const url = cache.get(id)
    if (url) URL.revokeObjectURL(url)
    cache.delete(id)
  }
}
