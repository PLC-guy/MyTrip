import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Trip } from './db'
import { fmtStamp } from './format'
import Sheet from './Sheet'
import { followLink, startSharing, stopSharing, useSyncStatus } from './sync'

/**
 * «Condividi in diretta» (menu ⋯ del viaggio): chi riceve il link segue il
 * viaggio in sola lettura e vede le novità man mano. Vedi sync.ts.
 */
export default function ShareSheet({ trip, onClose, leaving, swap }: { trip: Trip; onClose: () => void; leaving?: boolean; swap?: boolean }) {
  const share = useLiveQuery(() => db.shares.get(trip.id), [trip.id])
  const status = useSyncStatus(trip.id)
  const [working, setWorking] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [confirmStop, setConfirmStop] = useState(false)

  async function run(job: () => Promise<void>) {
    setWorking(true)
    setMsg(undefined)
    try {
      await job()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function sendLink() {
    if (!share) return
    const url = followLink(share)
    try {
      if (navigator.share) await navigator.share({ title: trip.name, text: `Segui il mio viaggio «${trip.name}» su MyTrip`, url })
      else {
        await navigator.clipboard.writeText(url)
        setMsg('Link copiato negli appunti.')
      }
    } catch {
      // Condivisione annullata: niente da dire.
    }
  }

  async function copyLink() {
    if (!share) return
    await navigator.clipboard.writeText(followLink(share)).then(
      () => setMsg('Link copiato negli appunti.'),
      () => setMsg('Non riesco a copiare: usa «Invia il link».'),
    )
  }

  const progress = status.total ? (
    <>
      <div className="progress">
        <div style={{ width: `${((status.done ?? 0) / status.total) * 100}%` }} />
      </div>
      <p className="small">Carico le foto: {status.done} di {status.total}</p>
    </>
  ) : status.busy || working ? (
    <div className="progress">
      <div className="indeterminate" />
    </div>
  ) : null

  // Prima condivisione in corso: la riga c'è già, ma il viaggio non è ancora tutto sul server.
  const ready = share?.role === 'owner' && share.v

  return (
    <Sheet onClose={onClose} leaving={leaving} swap={swap} locked={working}>
      <h2>Condividi in diretta</h2>
      {!ready ? (
        <>
          <p className="small">
            Chi riceve il link vede questo viaggio e le foto che aggiungi, man mano, anche mentre sei in viaggio. Può solo guardare: modificare resta a te.
          </p>
          <p className="small">
            Tutto viene cifrato su questo telefono prima di partire: il server conserva solo dati illeggibili, e la chiave sta nel link. Gli altri viaggi restano solo qui.
          </p>
          {progress}
          <div className="stack">
            <button className="btn" disabled={working} onClick={() => void run(() => startSharing(trip.id))}>
              {working ? 'Preparo il viaggio…' : share?.role === 'owner' ? 'Riprova' : 'Inizia a condividere'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="note-box" style={{ marginTop: 10 }}>
            {share.error ? (
              <>⚠️ {share.error}</>
            ) : status.busy ? (
              'Carico le novità…'
            ) : (
              <>📡 In diretta · aggiornato {share.at ? fmtStamp(share.at) : ''}</>
            )}
          </div>
          {progress}
          <div className="stack">
            <button className="btn" onClick={() => void sendLink()}>Invia il link</button>
            <button className="btn ghost" onClick={() => void copyLink()}>Copia il link</button>
          </div>
          <p className="small">
            Le novità partono da sole con l'app aperta, qualche secondo dopo ogni modifica. Senza connessione restano in coda e partono appena torna.
          </p>
          <p className="small">
            Chi ha il link può vedere il viaggio: mandalo solo a chi vuoi. Se finisce a qualcuno di troppo, smetti di condividere e ricomincia: il link nuovo sarà diverso.
          </p>
          {!confirmStop ? (
            <button className="btn danger" onClick={() => setConfirmStop(true)}>Smetti di condividere</button>
          ) : (
            <div className="stack">
              <p className="small" style={{ margin: 0 }}>
                Il viaggio si cancella dal server e chi lo segue non riceve più novità (tiene ciò che ha già visto). Sul tuo telefono non cambia niente.
              </p>
              <button className="btn danger" disabled={working} onClick={() => void run(async () => { await stopSharing(trip.id); onClose() })}>
                Smetti di condividere
              </button>
              <button className="btn ghost" onClick={() => setConfirmStop(false)}>Annulla</button>
            </div>
          )}
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </Sheet>
  )
}
