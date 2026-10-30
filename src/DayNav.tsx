import { useEffect, useState } from 'react'

/**
 * NAVIGAZIONE PER GIORNI nella pagina del viaggio (richiesta dell'utente,
 * 29/10/2026): con un viaggio lungo la cronologia è lunga, e tornare in cima o
 * passare al giorno dopo voleva dire tanti scroll. Tre pulsantini impilati in
 * basso a destra, discreti: giorno precedente, giorno successivo, torna in cima.
 * Compaiono solo quando si è scesi oltre la mappa.
 *
 * I giorni si leggono dalla pagina (`.timeline > section`), così questo
 * componente non dipende da come TripScreen li calcola. Con `days` 0 o 1 resta
 * solo «torna in cima»: è così anche nella Home.
 */
const SHOW_AFTER = 400

/** Margine sopra il giorno raggiunto: sotto l'intestazione fissa (o la barra di stato), più un po' d'aria. */
function topGap(): number {
  const status = document.querySelector('.statusbar-bg')?.getBoundingClientRect().bottom ?? 0
  const header = document.querySelector('.page > .bar')
  const stuck = header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0
  return Math.max(status, stuck) + 10
}

/** Posizione di ogni giorno rispetto al punto d'arrivo: ≤ 0 = già passato o raggiunto. */
function dayTops(): number[] {
  const gap = topGap()
  return [...document.querySelectorAll<HTMLElement>('.timeline > section')].map((s) => s.getBoundingClientRect().top - gap)
}

/** In fondo alla pagina: l'ultimo giorno, se è corto, non può salire fino in cima. */
const atBottom = () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2

/** Giorno in cui ci si trova: l'ultimo il cui inizio è già passato (−1 = sopra il primo). */
const currentDay = (tops: number[]) => tops.reduce((cur, t, i) => (t <= 1 ? i : cur), -1)

export default function DayNav({ days }: { days: number }) {
  const [state, setState] = useState({ show: false, prev: false, next: false })

  useEffect(() => {
    const update = () => {
      const tops = dayTops()
      const cur = currentDay(tops)
      setState({ show: window.scrollY > SHOW_AFTER, prev: cur >= 0, next: cur + 1 < tops.length && !atBottom() })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [days])

  const go = (dir: 1 | -1) => {
    const tops = dayTops()
    const cur = currentDay(tops)
    // Indietro: se si è a metà di un giorno si torna al suo inizio, se si è
    // proprio all'inizio si va al giorno prima.
    const target = dir > 0 ? cur + 1 : cur >= 0 && tops[cur] < -1 ? cur : cur - 1
    if (target < 0) return toTop()
    if (target >= tops.length || (dir > 0 && atBottom())) return
    window.scrollTo({ top: window.scrollY + tops[target], behavior: 'smooth' })
  }
  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  return (
    <div className={`day-nav${state.show ? ' on' : ''}`} aria-hidden={!state.show}>
      {days > 1 && (
        <>
          <button onClick={() => go(-1)} disabled={!state.prev} aria-label="Giorno precedente">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
          </button>
          <button onClick={() => go(1)} disabled={!state.next} aria-label="Giorno successivo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </>
      )}
      <button onClick={toTop} aria-label="Torna in cima">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12M12 20V9M7 13l5-5 5 5" /></svg>
      </button>
    </div>
  )
}
