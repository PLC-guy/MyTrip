import { useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'

/**
 * QR CODE PER SEGUIRE UN VIAGGIO (richiesta dell'utente, 1/11/2026)
 *
 * Chi viaggia mostra il link come QR code; chi segue lo inquadra dentro l'app,
 * senza passare da WhatsApp o da Safari (che sull'iPhone apre il link fuori
 * dall'app installata). Tutto sul telefono: si genera con qrcode-generator e si
 * legge con jsQR dalla fotocamera. ⚠️ Safari non ha BarcodeDetector, per questo
 * serve jsQR, caricato solo quando si apre la fotocamera.
 *
 * Il QR contiene il link intero, chiave compresa: vale quanto il link.
 */
export function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { size: n, path: d }
  }, [text])
  // Bordo bianco di 4 moduli, come vuole lo standard: con meno alcuni lettori faticano.
  return (
    <svg className="qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label="QR code del link">
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={path} fill="#000" shapeRendering="crispEdges" />
    </svg>
  )
}

/** Fotocamera che cerca un QR code; `onCode` riceve il testo letto, poi la fotocamera si spegne. */
export function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const canvas = document.createElement('canvas')

    void (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([import('jsqr'), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })])
        stream = media
        if (stopped) return media.getTracks().forEach((t) => t.stop())
        const v = video.current!
        v.srcObject = media
        await v.play()
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        // Cinque fotogrammi al secondo bastano, e il telefono non si scalda.
        const look = () => {
          if (stopped) return
          if (v.videoWidth) {
            const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight))
            canvas.width = Math.round(v.videoWidth * scale)
            canvas.height = Math.round(v.videoHeight * scale)
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (found?.data) {
              stopped = true
              media.getTracks().forEach((t) => t.stop())
              onCode(found.data)
              return
            }
          }
          timer = setTimeout(look, 200)
        }
        look()
      } catch (e) {
        const name = e instanceof DOMException ? e.name : ''
        setError(
          name === 'NotAllowedError'
            ? "Fotocamera non permessa. Si attiva nelle Impostazioni dell'iPhone › MyTrip (o Safari) › Fotocamera."
            : name === 'NotFoundError'
              ? 'Nessuna fotocamera trovata su questo dispositivo.'
              : 'Non riesco ad aprire la fotocamera.',
        )
      }
    })()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])

  return (
    <div className="qr-scanner">
      {error ? <p className="note-box warm" style={{ margin: 0 }}>{error}</p> : <video ref={video} playsInline muted />}
    </div>
  )
}
