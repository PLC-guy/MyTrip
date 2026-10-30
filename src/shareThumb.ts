import { canvasToJpeg } from './thumb'

/**
 * MINIATURE PER GLI EXPORT DA CONDIVIDERE (scelta dell'utente, 30/10/2026)
 *
 * WhatsApp manda i documenti così come sono e, col traffico del telefono, un
 * viaggio grande da 9,6 MB non partiva (un video da 9 MB passava solo perché
 * WhatsApp lo riduceva a 1,2 MB). Nei file mandati ad altri le miniature
 * scendono a SHARE_MAX px: Vietnam, 267 foto, da 9,4 a ~2,6 MB. Il backup e le
 * foto sul telefono restano come sono.
 *
 * Codificatore mozjpeg come le miniature (canvasToJpeg in thumb.ts).
 */
const SHARE_MAX = 320
const SHARE_QUALITY = 55

export async function shareThumb(thumb: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(thumb)
  const scale = Math.min(1, SHARE_MAX / Math.max(bmp.width, bmp.height))
  const width = Math.max(1, Math.round(bmp.width * scale))
  const height = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  return canvasToJpeg(canvas, SHARE_QUALITY)
}
