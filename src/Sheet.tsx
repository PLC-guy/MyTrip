import { useEffect, useRef, type ReactNode } from 'react'

/** Foglio che sale dal basso. Si chiude toccando fuori, salvo `locked`. */
export default function Sheet({ children, onClose, locked }: { children: ReactNode; onClose: () => void; locked?: boolean }) {
  const backdrop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
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

  return (
    <div ref={backdrop} className="sheet-backdrop" onClick={() => !locked && onClose()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grab" />
        {children}
      </div>
    </div>
  )
}
