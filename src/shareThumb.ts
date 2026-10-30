/**
 * MINIATURE PER GLI EXPORT DA CONDIVIDERE (scelta dell'utente, 30/10/2026)
 *
 * WhatsApp manda i documenti così come sono e, col traffico del telefono, un
 * viaggio grande da 9,6 MB non partiva (un video da 9 MB passava solo perché
 * WhatsApp lo riduceva a 1,2 MB). Nei file mandati ad altri le miniature
 * scendono a SHARE_MAX px: Vietnam, 267 foto, da 9,4 a ~2,6 MB. Il backup e le
 * foto sul telefono restano come sono.
 *
 * ⚠️ Codificatore mozjpeg (WebAssembly, @jsquash/jpeg) e non il JPEG del canvas
 * di Safari, che a parità di qualità pesa circa una volta e mezza di più. Si
 * carica solo qui, al primo export; se non si carica si ripiega sul canvas.
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
  try {
    const { default: encode } = await import('@jsquash/jpeg/encode')
    const out = await encode(ctx.getImageData(0, 0, width, height), { quality: SHARE_QUALITY })
    return new Blob([out], { type: 'image/jpeg' })
  } catch {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('miniatura non creata'))), 'image/jpeg', SHARE_QUALITY / 100))
  } finally {
    // Su iOS la memoria dei canvas è contata: si libera subito.
    canvas.width = 0
    canvas.height = 0
  }
}
