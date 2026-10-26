import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { fmtRange, plural } from './format'
import { IconBack } from './icons'
import MapView from './MapView'
import type { Route } from './App'

/** «TH» → 🇹🇭: le bandiere sono coppie di lettere «regionali» Unicode. */
const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))

interface CountryRow {
  code: string
  name: string
  trips: Set<string>
  stops: number
  first: string
  last: string
}

export default function CountriesScreen({ go }: { go: (r: Route) => void }) {
  const stops = useLiveQuery(() => db.stops.orderBy('start').toArray())
  const pending = stops?.some((s) => !s.countryCode) ?? false

  const rows = useMemo(() => {
    const map = new Map<string, CountryRow>()
    for (const s of stops ?? []) {
      if (!s.countryCode) continue
      const row = map.get(s.countryCode) ?? { code: s.countryCode, name: s.country ?? s.countryCode, trips: new Set<string>(), stops: 0, first: s.first, last: s.first }
      row.trips.add(s.tripId)
      row.stops++
      row.last = s.first
      map.set(s.countryCode, row)
    }
    // In ordine di prima visita.
    return [...map.values()]
  }, [stops])

  const codes = rows.map((r) => r.code)

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Paesi visitati</h1>
      </div>

      {stops && (
        // La chiave forza una mappa nuova quando cambia l'elenco: i paesi
        // colorati si decidono una volta, al caricamento dello stile.
        // Le tappe si inquadrano ma non si disegnano: coprirebbero i paesi piccoli.
        <MapView
          key={codes.join(',')}
          pins={[]}
          fitPoints={stops}
          lines={[]}
          fitKey={codes.join(',')}
          fitMaxZoom={4}
          countries={{ codes, color: '#2F6B4F' }}
        />
      )}

      <h2 className="section-title">{rows.length ? plural(rows.length, 'paese', 'paesi') : 'Ancora nessun paese'}</h2>
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
