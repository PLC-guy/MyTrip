import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, followedTripIds, KIND_FILTERS, type KindFilter } from './db'
import { fmtRange, plural } from './format'
import { IconBack } from './icons'
import MapView from './MapView'
import { useCountryColor } from './appearance'
import type { Route } from './App'

/** «TH» → 🇹🇭: le bandiere sono coppie di lettere «regionali» Unicode. */
const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))

/**
 * La mappa si apre sempre sul mondo intero, qualunque siano i paesi visitati:
 * è una «carta del mondo» da guardare, poi chi vuole zooma. Si inquadrano due
 * angoli del mondo abitato (senza l'Antartide).
 */
const WORLD = [
  { lat: -50, lon: -170 },
  { lat: 72, lon: 178 },
]


interface CountryRow {
  code: string
  name: string
  trips: Set<string>
  stops: number
  first: string
  last: string
}

export default function CountriesScreen({ go }: { go: (r: Route) => void }) {
  const [filter, setFilter] = useState<KindFilter>('tutti')
  const color = useCountryColor()
  const data = useLiveQuery(async () => {
    const skip = await followedTripIds()
    return { stops: (await db.stops.orderBy('start').toArray()).filter((s) => !skip.has(s.tripId)), trips: await db.trips.toArray() }
  })
  const pending = data?.stops.some((s) => !s.countryCode) ?? false

  const rows = useMemo(() => {
    // Un viaggio senza tipo vale «piacere», come nel resto dell'app.
    const kindOf = new Map((data?.trips ?? []).map((t) => [t.id, t.kind ?? 'piacere']))
    const map = new Map<string, CountryRow>()
    for (const s of data?.stops ?? []) {
      if (!s.countryCode) continue
      if (filter !== 'tutti' && kindOf.get(s.tripId) !== filter) continue
      const row = map.get(s.countryCode) ?? { code: s.countryCode, name: s.country ?? s.countryCode, trips: new Set<string>(), stops: 0, first: s.first, last: s.first }
      row.trips.add(s.tripId)
      row.stops++
      row.last = s.first
      map.set(s.countryCode, row)
    }
    // In ordine di prima visita.
    return [...map.values()]
  }, [data, filter])

  const codes = rows.map((r) => r.code)

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Paesi visitati</h1>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Quali viaggi">
        {KIND_FILTERS.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={filter === f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {data && (
        // La chiave forza una mappa nuova quando cambiano paesi o colore: i paesi
        // colorati si decidono una volta, al caricamento dello stile.
        <MapView key={`${codes.join(',')}|${color}`} world pins={[]} lines={[]} fitPoints={WORLD} fitKey="mondo" fitMaxZoom={4} countries={{ codes, color }} />
      )}

      <h2 className="section-title">{rows.length ? plural(rows.length, 'paese', 'paesi') : filter === 'tutti' ? 'Ancora nessun paese' : 'Nessun paese per questo tipo di viaggio'}</h2>
      {pending && <p className="small">Sto riconoscendo il paese di alcune tappe: l'elenco si completa da solo, serve la connessione.</p>}

      <div className="list">
        {rows.map((r) => (
          <div key={r.code}>
            <span>
              <span style={{ fontSize: '1.3rem', marginRight: 8 }}>{flag(r.code)}</span>
              {r.name}
            </span>
            <span className="k" style={{ textAlign: 'right' }}>
              {plural(r.trips.size, 'viaggio', 'viaggi')} · {plural(r.stops, 'tappa', 'tappe')}
              <br />
              {fmtRange(r.first, r.last)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
