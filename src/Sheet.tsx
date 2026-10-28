import { useEffect, useRef, type ReactNode } from 'react'

/** Trascinamento oltre il quale il foglio si chiude, in pixel… */
const CLOSE_PX = 110
/** …oppure una spinta veloce verso il basso, in pixel al millisecondo. */
const CLOSE_SPEED = 0.6

/**
 * Pagina ferma sotto i fogli aperti: un contatore, non «salva e ripristina».
 * ⚠️ Prima ogni foglio salvava il valore trovato e lo rimetteva alla chiusura:
 * con due fogli uno sopra l'altro (tappa + locali) chiusi insieme, il genitore
 * si chiude per primo e il figlio rimetteva «hidden». La pagina restava bloccata
 * su e giù finché non si chiudeva l'app (visto due volte sull'iPhone, 28/10/2026).
 */
let openSheets = 0
function lockPage() {
  openSheets++
  document.body.style.overflow = 'hidden'
}
function unlockPage() {
  openSheets = Math.max(0, openSheets - 1)
  if (openSheets === 0) document.body.style.overflow = ''
}

/** Foglio che sale dal basso. Si chiude toccando fuori o trascinandolo in basso, salvo `locked`. */
export default function Sheet({ children, onClose, locked }: { children: ReactNode; onClose: () => void; locked?: boolean }) {
  const backdrop = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const lockedRef = useRef(locked)
  useEffect(() => {
    closeRef.current = onClose
    lockedRef.current = locked
  })

  useEffect(() => {
    lockPage()
    return unlockPage
  }, [])

  /**
   * ⚠️ Su iPhone la tastiera si appoggia SOPRA la pagina invece di
   * rimpicciolirla: un foglio fissato al fondo dello schermo resterebbe dietro
   * la tastiera, e la casella in cui si scrive sarebbe nascosta. Il foglio
   * segue quindi la parte di schermo davvero visibile (visualViewport), che
   * si accorcia quando la tastiera si apre.
   */
  useEffect(() => {
    const vv = window.visualViewport
    const el = backdrop.current
    if (!vv || !el) return
    const fit = () => {
      el.style.top = `${vv.offsetTop}px`
      el.style.height = `${vv.height}px`
      el.style.bottom = 'auto'
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
    }
  }, [])

  /**
   * Trascinare in basso per chiudere, come i fogli di iOS (la maniglia in alto
   * lo promette; fino alla 0.10.1 non funzionava). Il trascinamento parte solo
   * se il contenuto è già in cima e il gesto è verticale: altrimenti il dito
   * scorre il contenuto del foglio o una galleria orizzontale. Ascoltatori a
   * mano, non passivi: durante il trascinamento la pagina non deve scorrere.
   */
  useEffect(() => {
    const el = sheet.current
    if (!el) return
    let startX = 0
    let startY = 0
    let startT = 0
    let dy = 0
    let dragging = false
    let ignore = false

    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startT = performance.now()
      dy = 0
      dragging = false
      // Nelle caselle di testo il dito serve a scrivere e selezionare.
      ignore = lockedRef.current === true || e.touches.length > 1 || (e.target as HTMLElement).closest('textarea, input') !== null
    }
    const move = (e: TouchEvent) => {
      if (ignore) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      dy = t.clientY - startY
      if (!dragging) {
        if (dy > 8 && dy > Math.abs(dx) && el.scrollTop <= 0) {
          dragging = true
          el.style.transition = 'none'
        } else if (Math.abs(dx) > 8 || dy < -8) {
          ignore = true
          return
        } else return
      }
      e.preventDefault()
      el.style.transform = `translateY(${Math.max(0, dy)}px)`
    }
    const end = () => {
      if (!dragging) return
      dragging = false
      const speed = dy / Math.max(1, performance.now() - startT)
      el.style.transition = 'transform 0.2s ease-out'
      if (dy > CLOSE_PX || speed > CLOSE_SPEED) {
        el.style.transform = 'translateY(100%)'
        setTimeout(() => closeRef.current(), 180)
      } else {
        el.style.transform = ''
      }
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [])

  return (
    <div ref={backdrop} className="sheet-backdrop" onClick={() => !locked && onClose()}>
      <div ref={sheet} className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grab" />
        {children}
      </div>
    </div>
  )
}
