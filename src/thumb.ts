/** Lato lungo della miniatura: nitida sulla mappa e nel dettaglio. */
const MAX = 540
/**
 * ⚠️ 0,62 e non più 0,78 (30/10/2026): il JPEG del canvas di Safari è poco
 * efficiente e a 0,78 le miniature pesavano ~97 KB (la stessa immagine fatta da
 * un codificatore migliore ne pesa 56). Gli export erano quindi enormi (40 MB per
 * 297 foto) e lenti da mandare su WhatsApp. Scelta dell'utente: miniature più
 * leggere, appena più morbide.
 */
const QUALITY = 0.62

export interface Thumb {
  blob: Blob
  width: number
  height: number
}

/**
 * Crea la miniatura JPEG di una foto. L'originale non si conserva: resta nella
 * galleria del telefono.
 *
 * createImageBitmap applica da solo l'orientamento EXIF; se il browser non ci
 * riesce si ripiega su un <img>, che lo applica anch'esso.
 */
export async function makeThumb(file: Blob): Promise<Thumb> {
  let source: ImageBitmap | HTMLImageElement
  try {
    source = await createImageBitmap(file)
  } catch {
    source = await loadImage(file)
  }

  const scale = Math.min(1, MAX / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas non disponibile')
  ctx.drawImage(source, 0, 0, width, height)
  if ('close' in source) source.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('miniatura non creata'))), 'image/jpeg', QUALITY),
  )
  // Su iOS la memoria dei canvas è contata: si libera subito.
  canvas.width = 0
  canvas.height = 0
  return { blob, width, height }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('immagine illeggibile'))
    }
    img.src = url
  })
}
