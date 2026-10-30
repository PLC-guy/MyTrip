import { useEffect, useState, type ReactNode } from 'react'
import { IconAddToHome, IconChevronDown, IconMenuLines, IconShare } from './icons'
import { safariVersion, useEnvironment, useInstallPrompt, type Platform } from './install'

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

/**
 * Freccia ancorata allo schermo, sul pulsante da toccare: `menu` (≡ accanto
 * all'indirizzo), `more` (⋯ in basso a destra), `share` (Condividi al centro,
 * iOS fino al 18), `up` (menu del browser in alto a destra, Android).
 */
function Arrow({ at }: { at: 'menu' | 'more' | 'share' | 'up' }) {
  return (
    <svg className={`install-arrow ${at === 'up' ? 'up' : `down ${at}`}`} viewBox="0 0 24 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
function Instructions({ platform, inApp, install, oldIos }: { platform: Platform; inApp: boolean; install: (() => void) | null; oldIos: boolean }) {
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

  if (platform === 'ios' && oldIos) {
    // iOS fino al 18: Condividi è in vista, al centro della barra in basso.
    return (
      <>
        <p className="install-lead">Pochi tocchi e MyTrip diventa un'app vera, con la sua icona sulla Home.</p>
        <Steps
          steps={[
            <>Tocca <strong>Condividi</strong> <IconShare />, al centro della barra in basso.</>,
            // ⚠️ Il testo esatto di iOS: in un elenco lungo si cerca la parola.
            <>Scorri e scegli <strong>«Aggiungi alla schermata Home»</strong> <IconAddToHome />.</>,
            <>Chiudi Safari e apri MyTrip <strong>dall'icona sulla Home</strong>.</>,
          ]}
        />
        <Arrow at="share" />
      </>
    )
  }

  if (platform === 'ios') {
    return (
      <>
        <p className="install-lead">Pochi tocchi e MyTrip diventa un'app vera, con la sua icona sulla Home.</p>
        <Steps
          steps={[
            // ⚠️ Safari di iOS 26 ha più disposizioni della barra, e la pagina non
            // sa quale: sul telefono dell'utente il menu è ≡ a sinistra
            // dell'indirizzo (screenshot del 27/10/2026), su un altro iPhone ⋯ in
            // basso a destra (28/10/2026). Si indicano entrambi, con due frecce.
            <>
              Tocca <strong>⋯</strong> in basso a destra, oppure <IconMenuLines /> accanto all'<strong>indirizzo</strong>.
            </>,
            <>Scegli <strong>Condividi</strong> <IconShare />.</>,
            <>Se non la vedi, tocca <strong>«Visualizza altro»</strong> <IconChevronDown />.</>,
            // ⚠️ Il testo esatto di iOS: in un elenco lungo si cerca la parola.
            <>Scegli <strong>«Aggiungi alla schermata Home»</strong> <IconAddToHome />.</>,
            <>Chiudi Safari e apri MyTrip <strong>dall'icona sulla Home</strong>.</>,
          ]}
        />
        <Arrow at="menu" />
        <Arrow at="more" />
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
          <Arrow at="up" />
        </>
      )}
    </>
  )
}

/**
 * Link di un viaggio da seguire aperto in Safari (da WhatsApp si apre sempre
 * qui, non nell'app installata). Il link va portato nell'app: si copia, e
 * nell'app si incolla in «Segui un viaggio».
 */
function FollowHint() {
  const [copied, setCopied] = useState(false)
  if (!location.hash.startsWith('#/segui/')) return null
  return (
    <div className="note-box" style={{ textAlign: 'left', margin: '12px 0' }}>
      <b>Hai ricevuto un viaggio da seguire.</b> Installa MyTrip (o aprila, se ce l'hai già), copia il link e incollalo nella Home in «Segui il viaggio di qualcuno» (se hai già dei viaggi: «Nuovo viaggio» › «Segui un viaggio»).
      <button
        className="btn"
        style={{ marginTop: 10 }}
        onClick={() => void navigator.clipboard.writeText(location.href).then(() => setCopied(true), () => {})}
      >
        {copied ? 'Link copiato ✓' : 'Copia il link'}
      </button>
    </div>
  )
}

/** `force`: solo in sviluppo, per vedere la guida di un dispositivo ('ios', 'ios18', 'android', 'app'). */
export default function InstallGate({ force }: { force?: string }) {
  const env = useEnvironment()
  const platform: Platform = force === 'ios' || force === 'ios18' ? 'ios' : force === 'android' ? 'android' : env.platform
  // Versione sconosciuta (altri browser): la guida di iOS 26, la più recente.
  const version = force === 'ios18' ? 18 : force === 'ios' ? 26 : safariVersion()
  const oldIos = version !== undefined && version < 26
  const inApp = force === 'app' || (!force && env.inApp)
  const install = useInstallPrompt()
  return (
    <div className="install">
      <div className="install-card">
        <img className="install-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <span className="label">Prima di partire</span>
        <h1>Installa MyTrip sulla Home</h1>
        <FollowHint />
        <Instructions platform={platform} inApp={inApp} install={install} oldIos={oldIos} />
        <p className="small">I viaggi restano sul tuo telefono. Solo quelli che decidi di condividere vengono inviati, cifrati, a un server.</p>
      </div>
    </div>
  )
}
