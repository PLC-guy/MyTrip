import { useEffect, useState } from 'react'
import { db, newId, type Lodging, type Stop, type Trip } from './db'
import { nearbyPlaces, SLEEP_RADII, type NearbyPlace } from './places'
import { addDays, nightsInRow } from './nights'
import { fmtDay } from './format'
import Sheet from './Sheet'
import MapsChooser from './MapsChooser'
import { IconMap } from './icons'
import { knownLodgingRating, rateLodging } from './venues'

/** Notti di fila che si possono segnare in una volta. */
const MAX_NIGHTS = 30

/**
 * «Dove hai dormito?» (pernottamenti, nights.ts): gli alloggi vicini
 * all'ultima tappa del giorno (OpenStreetMap, come i locali), dal più vicino,
 * oppure il nome scritto a mano. Si sceglie per quante notti di fila: l'app
 * compila da sola le sere successive.
 * «Fino alla fine del viaggio» (richiesta dell'utente, 2/11/2026: viaggi con
 * sempre lo stesso alloggio) sceglie in un tocco le notti fino all'ultimo giorno.
 */
export default function LodgingSheet({ trip, day, last, lastDay, onClose }: { trip: Trip; day: string; last: Stop; lastDay: string; onClose: () => void }) {
  const current = trip.nights?.[day]
  const run = nightsInRow(trip.nights, day)
  const [nights, setNights] = useState(Math.max(1, run))
  const [places, setPlaces] = useState<NearbyPlace[]>()
  const [error, setError] = useState(false)
  const [radius, setRadius] = useState<number>(SLEEP_RADII[0])
  const [peek, setPeek] = useState<NearbyPlace>()
  const [name, setName] = useState(current?.approx ? current.name : '')
  // Con un alloggio già scelto l'elenco si apre solo con «Cambia».
  const [searching, setSearching] = useState(!current)

  useEffect(() => {
    if (!searching) return
    let cancelled = false
    nearbyPlaces(last.lat, last.lon, radius, 'sleep')
      .then((p) => !cancelled && setPlaces(p))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [last.lat, last.lon, radius, searching])

  /**
   * Scrive l'alloggio per `count` notti da `day`. Le notti successive che
   * avevano lo stesso alloggio di prima (si sono accorciate) si tolgono.
   */
  async function write(lodging: Lodging | undefined, count: number) {
    const next = { ...(trip.nights ?? {}) }
    for (let i = 0; i < Math.max(run, 1); i++) {
      const d = addDays(day, i)
      if (current && next[d]?.id === current.id) delete next[d]
    }
    if (lodging) for (let i = 0; i < count; i++) next[addDays(day, i)] = lodging
    await db.trips.update(trip.id, { nights: Object.keys(next).length ? next : undefined })
    onClose()
  }

  // Lo stesso posto già scelto tiene il suo id: le notti restano «di fila».
  // Il voto: quello già dato a questo alloggio in altre notti o altri viaggi (venues.ts).
  const pick = async (p: { name: string; kind?: string; lat: number; lon: number; address?: string; approx?: boolean }) => {
    const same = current && current.name === p.name
    const rating = (await knownLodgingRating(p)) ?? (same ? current.rating : undefined)
    await write({ id: same ? current.id : newId(), ...p, rating }, nights)
    if (rating != null) await rateLodging(p, rating)
  }

  const until = addDays(day, nights)
  // Notti da questa sera all'ultimo giorno del viaggio (quel giorno si riparte).
  const toEnd = Math.min(MAX_NIGHTS, Math.round((Date.parse(lastDay + 'T12:00:00Z') - Date.parse(day + 'T12:00:00Z')) / 86_400_000))
  const wider = radius < SLEEP_RADII[1] && (
    <button className="btn ghost small-btn" type="button" onClick={() => { setPlaces(undefined); setError(false); setRadius(SLEEP_RADII[1]) }}>
      Cerca fino a {SLEEP_RADII[1] / 1000} km
    </button>
  )

  return (
    <Sheet onClose={onClose}>
      <h2>Dove hai dormito?</h2>
      <p className="small">La notte di {fmtDay(day + 'T12:00:00')}.</p>

      <div className="nights-row">
        <span className="small">Notti di fila</span>
        <span className="stepper">
          <button type="button" className="btn ghost small-btn" disabled={nights <= 1} onClick={() => setNights(nights - 1)} aria-label="Una notte in meno">−</button>
          <b>{nights}</b>
          <button type="button" className="btn ghost small-btn" disabled={nights >= MAX_NIGHTS} onClick={() => setNights(nights + 1)} aria-label="Una notte in più">+</button>
        </span>
      </div>
      <p className="small" style={{ marginTop: 4 }}>
        Riparti {fmtDay(until + 'T12:00:00')}.{nights > 1 ? ' Le sere in mezzo si compilano da sole.' : ''}
      </p>
      {toEnd > 1 && nights !== toEnd && (
        <button type="button" className="btn ghost small-btn" onClick={() => setNights(toEnd)}>
          Fino alla fine del viaggio · {toEnd} notti
        </button>
      )}

      {current && (
        <div className="meal-box">
          <div className="meal-head">
            <span>
              <b>🛏 {current.name}</b>
              <span className="k">{[current.kind, current.address].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
          {/* Un voto per alloggio: vale per tutte le notti lì, anche in altri viaggi. */}
          <div className="rating" role="radiogroup" aria-label="Voto">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={current.rating === n}
                aria-label={`${n} su 5`}
                className={(current.rating ?? 0) >= n ? 'on' : ''}
                onClick={() => void rateLodging(current, current.rating === n ? undefined : n)}
              >
                ★
              </button>
            ))}
          </div>
          <div className="stack">
            {nights !== run && <button className="btn" onClick={() => void write(current, nights)}>Salva {nights === 1 ? '1 notte' : `${nights} notti`}</button>}
            {!searching && <button className="btn ghost" onClick={() => setSearching(true)}>Cambia alloggio</button>}
            <button className="btn danger" onClick={() => void write(undefined, 0)}>{run > 1 ? `Togli queste ${run} notti` : 'Togli questa notte'}</button>
          </div>
        </div>
      )}

      {searching && (
        <>
          {!places && !error && <p className="small">Cerco gli alloggi vicini all'ultima tappa del giorno…</p>}
          {error && <p className="small">Serve la connessione per cercare gli alloggi, oppure il servizio non risponde. Puoi scrivere il nome qui sotto.</p>}
          {places && places.length === 0 && (
            <>
              <p className="small">Nessun alloggio sulla mappa entro {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}. Scrivi il nome qui sotto{radius < SLEEP_RADII[1] ? ' o cerca più lontano' : ''}.</p>
              {wider}
            </>
          )}
          {places && places.length > 0 && (
            <>
              <p className="small">{places.length >= 100 ? 'I 100 alloggi più vicini' : `${places.length === 1 ? '1 alloggio' : `${places.length} alloggi`} entro ${radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}`} dall'ultima tappa del giorno. Tocca la mappa accanto al nome per controllare.</p>
              <div className="list pick-list" style={{ marginTop: 10 }}>
                {places.map((p) => (
                  <div key={`${p.name}|${p.lat}|${p.lon}`} className={`meal-row${current?.name === p.name ? ' on' : ''}`}>
                    <button className="meal-pick" onClick={() => void pick({ name: p.name, kind: p.kind, lat: p.lat!, lon: p.lon!, address: p.address })}>
                      <span className="pick-text">
                        <b>{p.name}</b>
                        <span className="k">
                          {p.kind ? `${p.kind} · ` : ''}
                          {p.distance >= 1000 ? `${(p.distance / 1000).toFixed(1).replace('.', ',')} km` : `${p.distance} m`}
                        </span>
                      </span>
                    </button>
                    <button className="meal-map" aria-label={`Guarda ${p.name} nelle mappe`} onClick={() => setPeek(p)}>
                      <IconMap />
                    </button>
                  </div>
                ))}
              </div>
              {wider}
            </>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              // Nome a mano: la posizione non si conosce, si usa quella dell'ultima tappa.
              if (name.trim()) void pick({ name: name.trim(), lat: last.lat, lon: last.lon, address: last.place, approx: true })
            }}
          >
            <input className="field" value={name} maxLength={80} aria-label="Nome dell'alloggio" placeholder={places?.length ? "Non è nell'elenco? Scrivi il nome" : "Scrivi il nome dell'alloggio"} onChange={(e) => setName(e.target.value)} />
            <button className="btn" type="submit" disabled={!name.trim()}>
              Salva questo nome
            </button>
          </form>
        </>
      )}
      {peek && <MapsChooser target={{ name: peek.name, lat: peek.lat!, lon: peek.lon!, address: peek.address, search: true }} onClose={() => setPeek(undefined)} />}
    </Sheet>
  )
}
