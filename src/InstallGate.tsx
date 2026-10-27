import { useEffect, useState, type ReactNode } from 'react'
import { IconAddToHome, IconShare } from './icons'
import { useEnvironment, useInstallPrompt, type Platform } from './install'

/**
 * GUIDA ALL'INSTALLAZIONE
 *
 * Al posto dell'app, sul telefono, finché la si apre dal browser: i viaggi
 * creati lì finirebbero in un archivio che l'app sulla Home non legge (vedi
 * `install.ts`). ⚠️ Non si chiude: un avviso che si scavalca si scavalca senza
 * leggerlo. ⚠️ Non compare MAI nell'app installata.
 *
 * I passi si accendono uno alla volta, in giro, e una freccia indica il punto
 * dello schermo da toccare.
 */

const STEP_MS = 2200

/** Passo acceso in questo momento; fermo sul primo per chi ha tolto le animazioni. */
function useActiveStep(count: number): number {
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setActive((a) => (a + 1) % count), STEP_MS)
    return () => clearInterval(t)
  }, [count])
  return active
}

/** Freccia ancorata allo schermo: in basso a destra su iPhone, in alto a destra altrove. */
function Arrow({ dir }: { dir: 'down' | 'up' }) {
  return (
    <svg className={`install-arrow ${dir}`} viewBox="0 0 24 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v40" />
      <path d="M4 36l8 8 8-8" />
    </svg>
  )
}

function Steps({ steps }: { steps: ReactNode[] }) {
  const active = useActiveStep(steps.length)
  return (
    <ol className="install-steps">
      {steps.map((s, i) => (
        <li key={i} className={i === active ? 'on' : ''}>
          <span className="num" aria-hidden="true">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}

/** Le istruzioni cambiano col dispositivo: indicare un pulsante che lì non c'è è peggio di niente. */
function Instructions({ platform, inApp, install }: { platform: Platform; inApp: boolean; install: (() => void) | null }) {
  if (inApp) {
    return (
      <>
        <p className="install-lead">Stai guardando MyTrip dentro un'altra app: da qui non si installa. Aprila prima nel browser.</p>
        <Steps
          steps={[
            <>Tocca il menu di questa finestra: di solito i <strong>tre puntini</strong> in un angolo.</>,
            <>Scegli <strong>«Apri in Safari»</strong> o nel browser che usi.</>,
            <>Lì ritrovi questa guida e puoi installarla.</>,
          ]}
        />
      </>
    )
  }

  if (platform === 'ios') {
    return (
      <>
        <p className="install-lead">Quattro tocchi e MyTrip diventa un'app vera, con la sua icona sulla Home.</p>
        <Steps
          steps={[
            // ⚠️ Su iOS recente Condividi sta dentro il menu dei tre puntini, non in vista.
            <>Tocca i <strong>tre puntini</strong> in basso a destra.</>,
            <>Scegli <strong>Condividi</strong> <IconShare />.</>,
            // ⚠️ Il testo esatto di iOS: in un elenco lungo si cerca la parola.
            <>Scorri e scegli <strong>«Aggiungi alla schermata Home»</strong> <IconAddToHome />.</>,
            <>Chiudi Safari e apri MyTrip <strong>dall'icona sulla Home</strong>.</>,
          ]}
        />
        <Arrow dir="down" />
      </>
    )
  }

  // Android
  return (
    <>
      <p className="install-lead">Un tocco e MyTrip diventa un'app vera, con la sua icona sulla Home.</p>
      {install ? (
        <button className="btn" onClick={install}>
          Installa MyTrip
        </button>
      ) : (
        <>
          <Steps
            steps={[
              <>Tocca il menu <strong>⋮</strong> del browser, in alto a destra.</>,
              <>Scegli <strong>«Installa app»</strong> o «Aggiungi a schermata Home».</>,
              <>Apri MyTrip <strong>dall'icona sulla Home</strong>.</>,
            ]}
          />
          <Arrow dir="up" />
        </>
      )}
    </>
  )
}

/** `force`: solo in sviluppo, per vedere la guida di un dispositivo ('ios', 'android', 'app'). */
export default function InstallGate({ force }: { force?: string }) {
  const env = useEnvironment()
  const platform: Platform = force === 'ios' || force === 'android' ? force : env.platform
  const inApp = force === 'app' || (!force && env.inApp)
  const install = useInstallPrompt()
  return (
    <div className="install">
      <div className="install-card">
        <img className="install-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <span className="label">Prima di partire</span>
        <h1>Installa MyTrip sulla Home</h1>
        <Instructions platform={platform} inApp={inApp} install={install} />
        <p className="small">I viaggi restano sul tuo telefono: nessun account, nessun server.</p>
      </div>
    </div>
  )
}
