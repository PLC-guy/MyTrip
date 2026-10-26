import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { deliverFile, exportBackup, importFile } from './backup'
import { fmtBytes, plural } from './format'
import { geocodePending } from './geocode'
import { routesPending } from './routing'
import { IconBack } from './icons'
import { applyUpdate, buildLabel, versionLabel } from './update'
import type { Route } from './App'

export default function SettingsScreen({ go }: { go: (r: Route) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string>()
  const [working, setWorking] = useState(false)
  const [storage, setStorage] = useState<{ usage?: number; persisted?: boolean }>({})

  const counts = useLiveQuery(async () => ({ trips: await db.trips.count(), stops: await db.stops.count(), photos: await db.photos.count() }))

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.()
      const persisted = await navigator.storage?.persisted?.()
      setStorage({ usage: est?.usage, persisted })
    })()
  }, [counts])

  async function run(job: () => Promise<string | void>) {
    setWorking(true)
    setMsg(undefined)
    try {
      const r = await job()
      if (r) setMsg(r)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="page">
      <div className="bar">
        <button className="icon-btn" onClick={() => go({ name: 'home' })} aria-label="Indietro">
          <IconBack />
        </button>
        <h1>Impostazioni</h1>
      </div>

      <h2 className="section-title">Backup</h2>
      <div className="stack" style={{ display: 'grid', gap: 10 }}>
        <button className="btn ghost" disabled={working || !counts?.trips} onClick={() => void run(async () => deliverFile(await exportBackup()))}>
          Esporta tutti i viaggi
        </button>
        <label className="btn ghost" aria-disabled={working}>
          Importa un viaggio o un backup
          <input
            ref={input}
            className="hidden-input"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void run(async () => {
                const r = await importFile(file)
                void geocodePending()
                void routesPending()
                return `Importato: ${r.trips.join(', ')} (${plural(r.photos, 'foto', 'foto')})`
              })
            }}
          />
        </label>
        {msg && <div className="note-box">{msg}</div>}
        <p className="small">
          L'export contiene viaggi, tappe, note e miniature: si reimporta su un altro telefono o su un computer. Se un viaggio c'è già, si aggiorna senza doppioni.
        </p>
      </div>

      <h2 className="section-title">Archivio</h2>
      <div className="list">
        <div><span className="k">Viaggi</span><b>{counts?.trips ?? '…'}</b></div>
        <div><span className="k">Tappe</span><b>{counts?.stops ?? '…'}</b></div>
        <div><span className="k">Foto</span><b>{counts?.photos ?? '…'}</b></div>
        <div><span className="k">Spazio occupato</span><b>{storage.usage != null ? fmtBytes(storage.usage) : '—'}</b></div>
        <div><span className="k">Protetto dalla pulizia automatica</span><b>{storage.persisted == null ? '—' : storage.persisted ? 'sì' : 'no'}</b></div>
      </div>
      <p className="small">Le foto originali restano nella galleria del telefono: l'app conserva solo una miniatura per ciascuna.</p>

      <h2 className="section-title">Versione</h2>
      <div className="list">
        <div><span className="k">Versione</span><b>{versionLabel()}</b></div>
        <div><span className="k">Pubblicata</span><span>{buildLabel()}</span></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          className="btn ghost"
          onClick={() => {
            // ⚠️ Senza rete NON si riparte: si toglierebbe la copia offline e
            // l'app non si aprirebbe più finché la connessione non torna.
            if (!navigator.onLine) setMsg('Serve la connessione a internet per aggiornare.')
            else void applyUpdate()
          }}
        >
          Ricarica l'ultima versione
        </button>
      </div>
      <p className="small">Non serve quasi mai: l'app si aggiorna da sola quando la apri.</p>
    </div>
  )
}
