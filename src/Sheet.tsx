import { useEffect, type ReactNode } from 'react'

/** Foglio che sale dal basso. Si chiude toccando fuori, salvo `locked`. */
export default function Sheet({ children, onClose, locked }: { children: ReactNode; onClose: () => void; locked?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="sheet-backdrop" onClick={() => !locked && onClose()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grab" />
        {children}
      </div>
    </div>
  )
}
