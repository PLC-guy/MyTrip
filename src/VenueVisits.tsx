import { useEffect, useState } from 'react'

/** Una visita a un locale o un soggiorno in un alloggio, da aprire nel suo viaggio. */
export interface Visit {
  key: string
  /** «Roma 2025 · sab 3 mag», «Roma 2025 · sab 3 mag · 3 notti». */
  label: string
  color: string
  open: () => void
}

/**
 * LOCALI E ALLOGGI: SCELTA SULLA MAPPA (richiesta dell'utente, 2/11/2026)
 *
 * Un tocco sulla scheda (o sul pallino) sceglie il posto: la mappa agganciata in
 * alto lo centra e la scheda mostra le visite. Una sola: «Apri la tappa →» (o
 * «Apri la notte →»); più di una: una riga per visita, dalla più recente, e si
 * sceglie quale. Si apre il viaggio solo da lì, come «Apri il viaggio» in Home.
 */
export function useVenuePick() {
  const [picked, setPicked] = useState<string>()
  // La mappa si aggancia subito sotto l'intestazione fissa, che cambia altezza
  // col tema e la dimensione del testo: si misura (`--bar-h` in index.css).
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.page > .bar')
    if (!bar) return
    const set = () => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])
  const pick = (key: string, fromMap = false) => {
    const next = !fromMap && key === picked ? undefined : key
    setPicked(next)
    if (!next) return
    // Dopo il disegno (le visite cambiano l'altezza): la scheda sotto la mappa agganciata.
    requestAnimationFrame(() => {
      const card = document.getElementById(`venue-${next}`)
      const map = document.querySelector<HTMLElement>('.venue-map')
      if (!card || !map) return
      // Dove finisce la mappa quando è agganciata (il suo `top` calcolato
      // comprende la barra di stato dell'iPhone), non dove si trova adesso.
      const mapBottom = parseFloat(getComputedStyle(map).top) + map.offsetHeight
      const top = window.scrollY + card.getBoundingClientRect().top - mapBottom - 8
      window.scrollTo({ top: Math.max(0, top) })
    })
  }
  return [picked, pick] as const
}

export function VenueVisits({ visits, one }: { visits: Visit[]; one: string }) {
  if (visits.length === 1) {
    return (
      <button className="btn open-trip" onClick={visits[0].open}>
        {one} →
      </button>
    )
  }
  return (
    <div className="venue-visits">
      <p className="meta">Scegli la visita da aprire</p>
      {visits.map((v) => (
        <button key={v.key} className="btn ghost" onClick={v.open}>
          <span className="dot" style={{ background: v.color }} />
          {v.label} →
        </button>
      ))}
    </div>
  )
}
