import { TRIP_KINDS, type TripKind } from './db'

/** Scelta fra viaggio di piacere e di lavoro. */
export default function KindPicker({ value, onChange }: { value: TripKind; onChange: (k: TripKind) => void }) {
  return (
    <div className="kind-picker" role="radiogroup" aria-label="Tipo di viaggio">
      {TRIP_KINDS.map((k) => (
        <button key={k.key} type="button" role="radio" aria-checked={value === k.key} className={value === k.key ? 'on' : ''} onClick={() => onChange(k.key)}>
          {k.icon} {k.label}
        </button>
      ))}
    </div>
  )
}
