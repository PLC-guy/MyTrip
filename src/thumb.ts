/**
 * MINIATURE DELLE FOTO (0.17.0, richiesta dell'utente del 30/10/2026)
 *
 * Lato lungo THUMB_MAX px: sull'iPhone la foto della tappa è larga ~345 punti,
 * cioè ~1000 pixel veri. Fino alla 0.16 erano 540 px col JPEG del canvas di
 * Safari a qualità 0,62: sul telefono a metà risoluzione, nel browser sgranate.
 * (La lentezza degli export su WhatsApp che aveva portato a quei valori era il
 * segnale debole del telefono, non il peso dei file.)
 *
 * ⚠️ Codificatore mozjpeg (WebAssembly, @jsquash/jpeg), non il JPEG del canvas:
 * a parità di qualità pesa circa la metà. Se non si carica si ripiega sul canvas.
 * Le foto importate prima si migliorano riaggiungendole dalla galleria
 * (importPhotos.ts).
 */
export const THUMB_MAX = 1080
const QUALITY = 75

export interface Thumb {
  blob: Blob
  width: number
  height: number
}

/**
 * JPEG da un canvas già disegnato, con mozjpeg (qualità 0–100). Libera il
 * canvas: su iOS la memoria dei canvas è contata.
 */
export async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  try {
    const { default: encode } = await import('@jsquash/jpeg/encode')
    const out = await encode(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height), { quality })
    return new Blob([out], { type: 'image/jpeg' })
  } catch {
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('miniatura non creata'))), 'image/jpeg', quality / 100))
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
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

  const scale = Math.min(1, THUMB_MAX / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas non disponibile')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  if ('close' in source) source.close()

  return { blob: await canvasToJpeg(canvas, QUALITY), width, height }
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
