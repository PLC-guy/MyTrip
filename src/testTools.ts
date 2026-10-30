import { db, toStored } from './db'
import { photoKey, readMeta } from './exif'
import { makeThumb } from './thumb'
import { forgetThumbs } from './thumbUrl'

/**
 * 🧪 STRUMENTO DI PROVA, DA TOGLIERE (richiesta dell'utente, 30/10/2026)
 *
 * Rifà dall'originale della galleria le miniature delle foto GIÀ presenti
 * nell'app: serve solo durante le prove, per sistemare miniature rovinate o
 * fatte con regole vecchie (540 px). Le foto scelte che l'app non ha vengono
 * scartate e non entrano mai. Tappe, locali, note, stelline restano come sono.
 *
 * Si usa da Impostazioni › «🧪 Prove». Per toglierlo: questo file, la sezione
 * `TestTools` in SettingsScreen.tsx e i suoi stili `.test-tools` in index.css.
 */
export interface RefreshReport {
  /** Già presenti, ora più nitide. */
  updated: number
  /** Non presenti nell'app: scartate. */
  skipped: number
  /** Senza data/posizione o illeggibili. */
  unreadable: number
}

export async function refreshThumbs(files: File[], onProgress: (done: number, total: number) => void): Promise<RefreshReport> {
  const report: RefreshReport = { updated: 0, skipped: 0, unreadable: 0 }
  // Una foto alla volta, come l'import: su iPhone più foto da 12 MP insieme esauriscono la memoria.
  for (let i = 0; i < files.length; i++) {
    onProgress(i, files.length)
    const meta = await readMeta(files[i])
    if (!meta.ok) {
      report.unreadable++
      continue
    }
    const ids = await db.photos.where('key').equals(photoKey(meta.meta)).primaryKeys()
    if (ids.length === 0) {
      report.skipped++
      continue
    }
    try {
      const thumb = await makeThumb(files[i])
      const bytes = await toStored(thumb.blob)
      await db.transaction('rw', db.photos, () => Promise.all(ids.map((id) => db.photos.update(id, { thumb: bytes, width: thumb.width, height: thumb.height }))))
      forgetThumbs(ids.map(String))
      report.updated++
    } catch {
      report.unreadable++
    }
  }
  onProgress(files.length, files.length)
  return report
}
