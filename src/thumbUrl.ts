/**
 * Indirizzi delle miniature, uno per immagine e creati una volta sola: Dexie
 * restituisce un Blob nuovo a ogni lettura, e crearne uno a ogni disegno
 * riempirebbe la memoria di copie.
 *
 * ⚠️ Quando un'immagine viene cancellata o sostituita va DIMENTICATA con
 * `forgetThumbs`. Safari conserva i Blob di IndexedDB come file: cancellato il
 * record, l'indirizzo vecchio punta al vuoto. Un viaggio cancellato e poi
 * reimportato ha gli stessi id e, senza questo, mostrerebbe miniature vuote.
 *
 * ⚠️ Anche un Blob letto PRIMA di una riscrittura è morto (unire/dividere le
 * tappe riscrive le foto). Gli oggetti letti prima restano in memoria nelle
 * schermate ancora per un attimo: se si disegnano in quel momento, l'indirizzo
 * nato da loro va scartato. Per saperlo ogni Blob letto dal database riceve il
 * numero di giro (`markRead`, hook `reading` in db.ts) e ogni scrittura conclusa
 * alza il giro per i suoi id (`markWritten`).
 */
const cache = new Map<string, { url: string; seq: number }>()
const readAt = new WeakMap<Blob, number>()
const writtenAt = new Map<string, number>()
let seq = 0

/** Immagine vuota per il breve momento in cui c'è solo un Blob ormai morto. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export function thumbUrl(item: { id: string; thumb: Blob }): string {
  const written = writtenAt.get(item.id) ?? 0
  const hit = cache.get(item.id)
  if (hit && hit.seq >= written) return hit.url
  // Blob mai passato dal database (appena creato): è buono.
  const read = readAt.get(item.thumb) ?? seq
  if (read < written) return BLANK
  if (hit) URL.revokeObjectURL(hit.url)
  const url = URL.createObjectURL(item.thumb)
  cache.set(item.id, { url, seq: read })
  return url
}

export function forgetThumbs(ids: Iterable<string>): void {
  for (const id of ids) {
    const hit = cache.get(id)
    if (hit) URL.revokeObjectURL(hit.url)
    cache.delete(id)
  }
}

export function markRead(blob: unknown): void {
  if (blob instanceof Blob) readAt.set(blob, seq)
}

/** Da chiamare a scrittura conclusa: i Blob letti prima di adesso sono morti. */
export function markWritten(ids: Iterable<string>): void {
  seq++
  for (const id of ids) writtenAt.set(id, seq)
  forgetThumbs(ids)
}
