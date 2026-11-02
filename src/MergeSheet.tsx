import { useState } from 'react'
import type { Trip } from './db'
import { readWhole, type ExportFile } from './backup'
import { applyMerge, planMerge, type MergePlan } from './merge'
import { geocodePending } from './geocode'
import { routesPending } from './routing'
import { plural } from './format'
import Sheet from './Sheet'

type Step =
  | { kind: 'pick' }
  | { kind: 'choose'; data: ExportFile }
  | { kind: 'plan'; plan: MergePlan }
  | { kind: 'done'; plan: MergePlan }

/**
 * «Unisci un viaggio ricevuto» dal menu ⋯ del viaggio (merge.ts). `onClose`
 * torna al menu, `onDone` (finito o niente da unire) torna al viaggio.
 */
export default function MergeSheet({ trip, onClose, onDone, leaving, swap }: { trip: Trip; onClose: () => void; onDone: () => void; leaving?: boolean; swap?: boolean }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState(false)

  async function run(job: () => Promise<void>) {
    setWorking(true)
    setError(undefined)
    try {
      await job()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  const plan = (data: ExportFile, fromId: string) => run(async () => setStep({ kind: 'plan', plan: await planMerge(trip.id, data, fromId) }))

  function onFile(file: File | undefined) {
    if (!file) return
    void run(async () => {
      const data = await readWhole(file)
      if (data.trips.length === 0) throw new Error('Nel file non ci sono viaggi.')
      if (data.trips.length > 1) return setStep({ kind: 'choose', data })
      setStep({ kind: 'plan', plan: await planMerge(trip.id, data, data.trips[0].id) })
    })
  }

  const who = (p: MergePlan) => (p.from.by ? ` di ${p.from.by}` : '')

  return (
    <Sheet onClose={onClose} locked={working} leaving={leaving} swap={swap}>
      <h2>Unisci un viaggio ricevuto</h2>

      {step.kind === 'pick' && (
        <>
          <p className="small">
            Chi ha viaggiato con te esporta il suo viaggio da Impostazioni › Backup e ripristino e ti manda il file. Le sue foto entrano in «{trip.name}», quelle che hai già restano una volta sola.
          </p>
          <div className="stack">
            <label className="btn" aria-disabled={working}>
              {working ? 'Leggo il file…' : 'Scegli il file ricevuto'}
              {/* Nessun filtro: con «.mytrip» iOS renderebbe i file non sceglibili (vedi Impostazioni). */}
              <input className="hidden-input" type="file" disabled={working} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f) }} />
            </label>
          </div>
        </>
      )}

      {step.kind === 'choose' && (
        <>
          <p className="small">Nel file ci sono più viaggi. Scegli quello da unire a «{trip.name}».</p>
          <div className="stack">
            {step.data.trips.map((t) => (
              <button key={t.id} className="btn ghost" disabled={working} onClick={() => void plan(step.data, t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}

      {step.kind === 'plan' && (
        <>
          <p className="small">
            Da «{step.plan.from.name}»{who(step.plan)} a «{trip.name}».
          </p>
          <div className="list" style={{ marginTop: 14 }}>
            <div><span className="k">Foto nuove</span><b>{step.plan.photos.length}</b></div>
            <div><span className="k">Già presenti</span><b>{step.plan.already}</b></div>
            <div><span className="k">Tappe nuove</span><b>{step.plan.newStops}</b></div>
          </div>
          {hasChanges(step.plan) ? (
            <>
              <p className="small">Nomi, locali e mezzi delle tue tappe restano i tuoi. Le note si mettono una sotto l'altra.</p>
              <div className="stack">
                <button
                  className="btn"
                  disabled={working}
                  onClick={() =>
                    void run(async () => {
                      await applyMerge(step.plan)
                      void geocodePending()
                      void routesPending()
                      setStep({ kind: 'done', plan: step.plan })
                    })
                  }
                >
                  {working ? 'Unisco…' : step.plan.photos.length ? `Unisci ${plural(step.plan.photos.length, 'foto', 'foto')}` : 'Unisci'}
                </button>
                <button className="btn ghost" disabled={working} onClick={onClose}>Annulla</button>
              </div>
            </>
          ) : (
            <>
              <p className="small">Hai già tutto quello che c'è nel file.</p>
              <div className="stack">
                <button className="btn" onClick={onDone}>Chiudi</button>
              </div>
            </>
          )}
        </>
      )}

      {step.kind === 'done' && (
        <>
          <p role="status">
            {step.plan.photos.length ? `Sono entrate ${plural(step.plan.photos.length, 'foto', 'foto')}${who(step.plan)}.` : 'Viaggio aggiornato.'}
          </p>
          <p className="small">
            {step.plan.differences
              ? `Ho trovato ${plural(step.plan.differences, 'differenza', 'differenze')} con le tue tappe. Nomi, locali e mezzi sono rimasti i tuoi, le note sono una sotto l'altra con chi le ha scritte.`
              : 'Nessuna differenza con le tue tappe.'}
          </p>
          <div className="stack">
            <button className="btn" onClick={onDone}>Fatto</button>
          </div>
        </>
      )}

      {error && <div className="note-box warm" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  )
}

const hasChanges = (p: MergePlan) => p.photos.length > 0 || p.stops.length > 0 || !!p.diary || !!p.nights
