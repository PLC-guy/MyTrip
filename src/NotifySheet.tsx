import { useState } from 'react'
import type { Share } from './db'
import Sheet from './Sheet'
import { notificationsSupported, setNotify, type NotifyMode } from './sync'

/**
 * Notifiche di un viaggio seguito (idea dell'utente, 30/10/2026): le sceglie
 * ciascun telefono che segue, per sé. Spente, a ogni novità (al più una ogni
 * 15 minuti: un import di 50 foto non manda 50 avvisi), o un riepilogo al
 * giorno all'ora scelta, solo se ci sono novità. Vedi sync.ts e server/worker.js.
 */
export default function NotifySheet({ share, onClose, leaving, swap }: { share: Share; onClose: () => void; leaving?: boolean; swap?: boolean }) {
  const [mode, setMode] = useState<NotifyMode | 'off'>(share.notify?.mode ?? 'off')
  const [hour, setHour] = useState(share.notify?.hour ?? 20)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const supported = notificationsSupported()

  async function save() {
    setWorking(true)
    setError(undefined)
    try {
      // ⚠️ Subito, senza attese prima: iOS chiede il permesso solo dopo un tocco.
      await setNotify(share.tripId, mode === 'off' ? null : { mode, hour })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  const options: { key: NotifyMode | 'off'; label: string; hint: string }[] = [
    { key: 'off', label: 'Spente', hint: 'Vedi le novità quando apri l\'app.' },
    { key: 'each', label: 'A ogni novità', hint: 'Quando arrivano foto nuove; al massimo una notifica ogni 15 minuti.' },
    { key: 'daily', label: 'Una al giorno', hint: 'Un riepilogo all\'ora che scegli, solo nei giorni con foto nuove.' },
  ]

  return (
    <Sheet onClose={onClose} leaving={leaving} swap={swap} locked={working}>
      <h2>Notifiche</h2>
      {!supported ? (
        <p className="small">
          Su iPhone le notifiche funzionano solo nell'app installata sulla schermata Home, con iOS 16.4 o più recente.
        </p>
      ) : (
        <>
          <div className="stack notify-options" role="radiogroup" aria-label="Notifiche">
            {options.map((o) => (
              <label key={o.key} className={`pick${mode === o.key ? ' on' : ''}`}>
                <input type="radio" name="notify" checked={mode === o.key} onChange={() => setMode(o.key)} />
                <span className="pick-text">
                  <b>{o.label}</b>
                  <span className="k">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {mode === 'daily' && (
            <label className="notify-hour">
              Alle ore
              <select className="field" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="stack">
            <button className="btn" disabled={working} onClick={() => void save()}>
              {working ? 'Salvo…' : 'Salva'}
            </button>
          </div>
          <p className="small">Il testo della notifica viaggia cifrato: il server lo inoltra senza poterlo leggere.</p>
        </>
      )}
      {error && <p className="note-box warm" style={{ marginTop: 12 }}>{error}</p>}
    </Sheet>
  )
}
