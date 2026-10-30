import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { exportTrips, importFile } from './backup'
import { shareExport } from './exportFlow'
import Sheet from './Sheet'
import { backupDue, describeBackupAge, runBackup, useBackupState } from './backupReminder'
import { fmtBytes, fmtRange, plural } from './format'
import { geocodePending } from './geocode'
import { routesPending } from './routing'
import { IconBack } from './icons'
import { applyUpdate, buildLabel, versionLabel } from './update'
import { COUNTRY_COLORS, setCountryColor, useCountryColor } from './appearance'
import { THEMES, setTheme, useTheme } from './theme'
import type { Route } from './App'

/**
 * IMPOSTAZIONI
 *
 * In alto le voci che si CAMBIANO, come pulsanti che aprono una pagina loro
 * (Aspetto, Backup e ripristino); sotto, subito visibili, quelle in sola
 * lettura (Archivio, Versione). Struttura come in MyBsns, richiesta il
 * 27/10/2026. Le pagine stanno nell'indirizzo (#/impostazioni/aspetto), così
 * «indietro» e un aggiornamento automatico riportano dove si era.
 */
export type SettingsPage = 'aspetto' | 'backup'

export default function SettingsScreen({ page, go }: { page?: SettingsPage; go: (r: Route) => void }) {
  if (page === 'aspetto') return <AppearancePage go={go} />
  if (page === 'backup') return <BackupPage go={go} />
  return <SettingsHome go={go} />
}

function Bar({ title, back }: { title: string; back: () => void }) {
  return (
    <div className="bar">
      <button className="icon-btn" onClick={back} aria-label="Indietro">
        <IconBack />
      </button>
      <h1>{title}</h1>
    </div>
  )
}

/** Voce che apre una pagina: solo il nome, centrato, e la freccia (senza sottotitolo, scelta dell'utente). */
function NavItem({ title, due, onClick }: { title: string; due?: boolean; onClick: () => void }) {
  return (
    <button className={`nav-item${due ? ' due' : ''}`} onClick={onClick}>
      <b>{title}</b>
      <span className="chev" aria-hidden="true">›</span>
    </button>
  )
}

function SettingsHome({ go }: { go: (r: Route) => void }) {
  const backup = useBackupState()
  const [msg, setMsg] = useState<string>()
  const [storage, setStorage] = useState<{ usage?: number; persisted?: boolean }>({})
  const counts = useLiveQuery(async () => ({ trips: await db.trips.count(), stops: await db.stops.count(), photos: await db.photos.count() }))

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.()
      const persisted = await navigator.storage?.persisted?.()
      setStorage({ usage: est?.usage, persisted })
    })()
  }, [counts])

  return (
    <div className="page">
      <Bar title="Impostazioni" back={() => go({ name: 'home' })} />

      <div className="list nav-list">
        <NavItem title="Aspetto" onClick={() => go({ name: 'settings', page: 'aspetto' })} />
        {/* Il promemoria si vede anche qui: un backup da fare non deve sparire dietro un livello. */}
        <NavItem
          title="Backup e ripristino"
          due={counts != null && backupDue(backup, counts.photos)}
          onClick={() => go({ name: 'settings', page: 'backup' })}
        />
      </div>

      <h2 className="section-title">Archivio</h2>
      <div className="list">
        <div><span className="k">Viaggi</span><b>{counts?.trips ?? '…'}</b></div>
        <div><span className="k">Tappe</span><b>{counts?.stops ?? '…'}</b></div>
        <div><span className="k">Foto</span><b>{counts?.photos ?? '…'}</b></div>
        <div><span className="k">Spazio occupato</span><b>{storage.usage != null ? fmtBytes(storage.usage) : '—'}</b></div>
        <div><span className="k">Protetto dalla pulizia automatica</span><b>{storage.persisted == null ? '—' : storage.persisted ? 'sì' : 'no'}</b></div>
      </div>
      <p className="small">Le foto originali restano nella galleria del telefono, l'app conserva solo le miniature.</p>

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
      {msg && <div className="note-box" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  )
}

function AppearancePage({ go }: { go: (r: Route) => void }) {
  const countryColor = useCountryColor()
  const theme = useTheme()
  return (
    <div className="page">
      <Bar title="Aspetto" back={() => go({ name: 'settings' })} />

      <h2 className="section-title">Tema</h2>
      {/* Ogni scheda si disegna con i colori del suo tema: si sceglie guardando. */}
      <div className="themes" role="radiogroup" aria-label="Tema">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={`theme-card theme-${t.id}${theme === t.id ? ' on' : ''}`}
            style={{ background: t.preview.bg }}
            onClick={() => setTheme(t.id)}
          >
            <span className="theme-sample" style={{ background: t.preview.card }}>
              {[t.preview.accent, t.preview.blue, t.preview.saff].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="theme-text">
              <b style={{ color: t.preview.accent }}>{t.name}</b>
              <span>{t.description}</span>
            </span>
          </button>
        ))}
      </div>

      <h2 className="section-title">Colore dei paesi visitati</h2>
      <div className="swatches">
        {COUNTRY_COLORS.map((c) => (
          <button key={c} className={`swatch${countryColor.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ background: c }} aria-label={`Colore ${c}`} onClick={() => setCountryColor(c)} />
        ))}
        {/* Colore libero: il selettore di sistema dell'iPhone. */}
        <label className={`swatch swatch-custom${COUNTRY_COLORS.some((c) => c.toLowerCase() === countryColor.toLowerCase()) ? '' : ' on'}`} aria-label="Scegli un altro colore">
          <input type="color" value={countryColor} onChange={(e) => setCountryColor(e.target.value)} />
        </label>
      </div>
    </div>
  )
}

function BackupPage({ go }: { go: (r: Route) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string>()
  const [working, setWorking] = useState(false)
  const backup = useBackupState()
  const trips = useLiveQuery(() => db.trips.count())
  const [choosing, setChoosing] = useState(false)

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
      <Bar title="Backup e ripristino" back={() => go({ name: 'settings' })} />

      <h2 className="section-title">Backup</h2>
      <p className="small">
        Ultimo backup completo: <b>{describeBackupAge(backup)}</b>.
        <br />I viaggi esistono solo su questo telefono, ricorda di conservarli.
      </p>
      <button className="btn" disabled={working || !trips} onClick={() => void run(async () => ((await runBackup()) ? 'Backup esportato con successo!' : undefined))}>
        Esporta tutti i viaggi
      </button>

      <h2 className="section-title">Esporta alcuni viaggi</h2>
      <p className="small">Per passare qualche viaggio a qualcuno. Più viaggi finiscono in un unico file, con foto alleggerite per mandarle facilmente.</p>
      <button className="btn ghost" disabled={working || !trips} onClick={() => setChoosing(true)}>
        Scegli i viaggi da esportare
      </button>
      {choosing && (
        <ChooseTrips
          onClose={() => setChoosing(false)}
          onExport={(ids) => {
            setChoosing(false)
            const label = ids.length === 1 ? '1 viaggio' : `${ids.length} viaggi`
            void run(async () => ((await shareExport(label, (p) => exportTrips(ids, p))) ? `Esportat${ids.length === 1 ? 'o 1 viaggio' : `i ${ids.length} viaggi`}.` : undefined))
          }}
        />
      )}

      {/* Riguarda gli export, quindi sta sopra il ripristino (scelta dell'utente). */}
      <p className="small">Gli export contengono viaggi, tappe, note, diario, percorsi e miniature.</p>

      <h2 className="section-title">Ripristino</h2>
      <p className="small">Puoi importare un singolo viaggio o un backup completo, anche fatto su un altro telefono. Se un viaggio c'è già, si aggiorna.</p>
      <label className="btn ghost" aria-disabled={working}>
        Importa un viaggio o un backup
        <input
          ref={input}
          className="hidden-input"
          type="file"
          // ⚠️ Nessun filtro: con un'estensione sconosciuta come «.mytrip» il
          // selettore di iOS renderebbe i file grigi e non sceglibili. L'app
          // controlla da sé che il file sia di MyTrip.
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
      {msg && <div className="note-box" style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  )
}

/** Elenco dei viaggi con una casella ciascuno; dal più recente, come in Home. */
function ChooseTrips({ onClose, onExport }: { onClose: () => void; onExport: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const rows = useLiveQuery(async () => {
    const trips = await db.trips.toArray()
    const stops = await db.stops.orderBy('start').toArray()
    return trips
      .map((trip) => {
        const own = stops.filter((s) => s.tripId === trip.id)
        return { trip, stops: own.length, first: own[0]?.first, last: own.at(-1)?.first }
      })
      .sort((a, b) => (b.last ?? '9999').localeCompare(a.last ?? '9999'))
  })
  const all = rows != null && rows.length > 0 && picked.size === rows.length
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Sheet onClose={onClose}>
      <h2>Quali viaggi?</h2>
      <label className="check pick-all">
        <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows?.map((r) => r.trip.id)))} />
        Tutti
      </label>
      <div className="list pick-list">
        {rows?.map((r) => (
          <label key={r.trip.id} className="pick">
            <input type="checkbox" checked={picked.has(r.trip.id)} onChange={() => toggle(r.trip.id)} />
            <span className="dot" style={{ background: r.trip.color }} />
            <span className="pick-text">
              <b>{r.trip.name}</b>
              <span className="k">{r.first && r.last ? `${fmtRange(r.first, r.last)} · ${plural(r.stops, 'tappa', 'tappe')}` : 'Ancora vuoto'}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="stack">
        <button className="btn" disabled={picked.size === 0} onClick={() => onExport([...picked])}>
          {picked.size === 0 ? 'Scegli almeno un viaggio' : `Esporta ${plural(picked.size, 'viaggio', 'viaggi')}`}
        </button>
      </div>
    </Sheet>
  )
}
