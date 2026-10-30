import { useState } from 'react'
import Sheet from './Sheet'
import { follow, parseFollowCode } from './sync'

/**
 * «Segui un viaggio»: si incolla il link ricevuto da chi viaggia. ⚠️ Sull'iPhone
 * il link toccato in WhatsApp si apre in Safari, non nell'app installata (archivi
 * separati, vedi install.ts): per questo si incolla qui. Sul computer il link
 * apre direttamente questo foglio, già compilato.
 */
export default function FollowSheet({ initial, onClose, onFollowed }: { initial?: string; onClose: () => void; onFollowed: (tripId: string) => void }) {
  const [text, setText] = useState(initial ?? '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const code = parseFollowCode(text)

  async function start() {
    if (!code) return
    setWorking(true)
    setError(undefined)
    try {
      onFollowed(await follow(code))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Sheet onClose={onClose} locked={working}>
      <h2>Segui un viaggio</h2>
      <p className="small">Incolla il link che hai ricevuto. Vedrai il viaggio e le foto nuove man mano che arrivano; potrai solo guardare.</p>
      <div className="stack">
        <textarea className="field" placeholder="https://…#/segui/…" value={text} onChange={(e) => setText(e.target.value)} disabled={working} />
        {!text && navigator.clipboard?.readText && (
          <button className="btn ghost" onClick={() => void navigator.clipboard.readText().then(setText, () => {})}>
            Incolla
          </button>
        )}
        {text && !code && <p className="small" style={{ margin: 0 }}>Questo non sembra un link di MyTrip.</p>}
        {working && (
          <>
            <div className="progress">
              <div className="indeterminate" />
            </div>
            <p className="small" style={{ margin: 0 }}>Scarico il viaggio: con molte foto ci vuole un po'.</p>
          </>
        )}
        <button className="btn" disabled={!code || working} onClick={() => void start()}>
          Segui
        </button>
      </div>
      {error && <p className="note-box warm" style={{ marginTop: 12 }}>{error}</p>}
    </Sheet>
  )
}
