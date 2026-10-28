import { useEffect, useState } from 'react'

/**
 * INSTALLATA SULLA HOME, O APERTA DAL BROWSER?
 *
 * ⚠️ Su iOS l'app installata ha un archivio SEPARATO da quello di Safari: stesso
 * indirizzo, due IndexedDB diversi. I viaggi creati nel browser l'app sulla Home
 * non li vede, e dopo l'installazione sembrano spariti. Per questo sul telefono,
 * dal browser, si mostra solo la guida all'installazione (`InstallGate.tsx`).
 *
 * Sul computer invece l'app si usa anche nel browser (per esempio per importare
 * un viaggio ricevuto): lì nessuna guida obbligatoria.
 *
 * Ripreso dalla struttura di MyBsns.
 */
export type Platform = 'ios' | 'android' | 'desktop'

export interface Environment {
  /** Aperta dall'icona sulla Home. */
  installed: boolean
  platform: Platform
  /** Browser interno di un'altra app (WhatsApp, Telegram, Instagram…): da lì non si installa. */
  inApp: boolean
}

function isStandalone(): boolean {
  // ⚠️ Basta UN segnale: sbagliare in questo verso mostra una guida di troppo,
  // sbagliare nell'altro chiuderebbe fuori chi l'app ce l'ha già.
  if (['standalone', 'minimal-ui', 'window-controls-overlay'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches)) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  // iPadOS si presenta come un Mac, ma col touch screen.
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return 'ios'
  return 'desktop'
}

function detectInApp(platform: Platform): boolean {
  const ua = navigator.userAgent
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Telegram|WhatsApp|Snapchat/i.test(ua)) return true
  // Su iOS il browser vero dice «Safari» o si dichiara Chrome/Firefox/Edge.
  if (platform === 'ios') return !/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return false
}

/**
 * Versione principale di Safari («Version/26.0» → 26), che su iOS segue quella
 * del sistema. ⚠️ Dice la versione, NON la disposizione della barra: su iOS 26
 * Safari ha più disposizioni (Impostazioni › App › Safari), con il menu ≡ accanto
 * all'indirizzo o ⋯ in basso a destra, e la pagina non può sapere quale.
 * Visto il 28/10/2026 su due iPhone diversi.
 */
export function safariVersion(): number | undefined {
  const m = /Version\/(\d+)/.exec(navigator.userAgent)
  return m ? Number(m[1]) : undefined
}

export function readEnvironment(): Environment {
  const platform = detectPlatform()
  return { installed: isStandalone(), platform, inApp: detectInApp(platform) }
}

export function useEnvironment(): Environment {
  const [env, setEnv] = useState(readEnvironment)
  useEffect(() => {
    const q = window.matchMedia('(display-mode: standalone)')
    const update = () => setEnv(readEnvironment())
    q.addEventListener('change', update)
    return () => q.removeEventListener('change', update)
  }, [])
  return env
}

type InstallPrompt = Event & { prompt: () => Promise<void> }

/**
 * L'invito a installare di Android. ⚠️ L'evento arriva una volta sola e va
 * trattenuto per usarlo al tocco del pulsante. Su iOS non esiste.
 */
export function useInstallPrompt(): (() => void) | null {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  useEffect(() => {
    const keep = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', keep)
    return () => window.removeEventListener('beforeinstallprompt', keep)
  }, [])
  if (!prompt) return null
  return () => {
    void prompt.prompt()
    setPrompt(null)
  }
}
