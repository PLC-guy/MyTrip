import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { colorName, db } from './db'
import { applyImport, estimateExport, exportTrips, readImport, type ParsedImport } from './backup'
import { shareExport } from './exportFlow'
import Sheet from './Sheet'
import { backupDue, describeBackupAge, photosToKeep, runBackup, useBackupState } from './backupReminder'
import { fmtBytes, fmtRange, plural } from './format'
import { geocodePending } from './geocode'
import { routesPending } from './routing'
import { IconBack } from './icons'
import { buildLabel, checkForUpdate, forceUpdate, installUpdate, takeUpdatedFrom, versionLabel } from './update'
import { COUNTRY_COLORS, setCountryColor, useCountryColor } from './appearance'
import { THEMES, setTheme, useTheme } from './theme'
import { setProfile, useProfile } from './profile'
import { pushAll } from './sync'
import { DEFAULT_GROUPING, GAP_LIMITS, getGrouping, RADIUS_LIMITS, setGrouping, useGrouping } from './grouping'
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
export type SettingsPage = 'viaggiatore' | 'tappe' | 'aspetto' | 'backup'

export default function SettingsScreen({ page, go }: { page?: SettingsPage; go: (r: Route) => void }) {
  if (page === 'viaggiatore') return <TravelerPage go={go} />
  if (page === 'tappe') return <GroupingPage go={go} />
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
  // «Cerca aggiornamenti»: riscontro come «Aggiorna ora» dei viaggi seguiti.
  const [updating, setUpdating] = useState<'controllo' | 'installo'>()
  const [update, setUpdate] = useState<{ text: string; retry?: boolean }>(() => {
    const from = takeUpdatedFrom()
    return from ? { text: `App aggiornata: prima avevi la ${from}, ora la ${__VERSION__}.` } : { text: '' }
  })
  async function searchUpdate() {
    setUpdating('controllo')
    setUpdate({ text: '' })
    const [r] = await Promise.all([checkForUpdate(), new Promise((res) => setTimeout(res, 700))])
    if (r === 'nuova') {
      setUpdating('installo')
      setUpdate({ text: "C'è una versione nuova, la installo. L'app si riapre da sola." })
      installUpdate()
      return
    }
    setUpdating(undefined)
    if (r === 'aggiornata') setUpdate({ text: `Hai già l'ultima versione, la ${__VERSION__}.`, retry: true })
    else if (r === 'offline') setUpdate({ text: 'Serve la connessione a internet per aggiornare.' })
    else setUpdate({ text: 'Non riesco a controllare adesso. Riprova tra poco.', retry: true })
  }
  const [storage, setStorage] = useState<{ usage?: number; persisted?: boolean }>({})
  const counts = useLiveQuery(async () => ({ trips: await db.trips.count(), stops: await db.stops.count(), photos: await db.photos.count() }))
  const keep = useLiveQuery(photosToKeep)

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
        <NavItem title="Il viaggiatore" onClick={() => go({ name: 'settings', page: 'viaggiatore' })} />
        <NavItem title="Tappe" onClick={() => go({ name: 'settings', page: 'tappe' })} />
        <NavItem title="Aspetto" onClick={() => go({ name: 'settings', page: 'aspetto' })} />
        {/* Il promemoria si vede anche qui: un backup da fare non deve sparire dietro un livello. */}
        <NavItem
          title="Backup e ripristino"
          due={keep != null && backupDue(backup, keep)}
          onClick={() => go({ name: 'settings', page: 'backup' })}
        />
      </div>

      <h2 className="section-title">Archivio</h2>
      <div className="list">
        <div><span className="k">Viaggi</span><b>{counts?.trips ?? '…'}</b></div>
        <div><span className="k">Tappe</span><b>{counts?.stops ?? '…'}</b></div>
        <div><span className="k">Foto</span><b>{counts?.photos ?? '…'}</b></div>
        <div><span className="k">Spazio occupato</span><b>{storage.usage != null ? fmtBytes(storage.usage) : '—'}</b></div>
        <div><span className="k">Al sicuro se il telefono libera spazio</span><b>{storage.persisted == null ? '—' : storage.persisted ? 'sì' : 'no'}</b></div>
      </div>
      {storage.persisted === false && <p className="small">Fai spesso il backup completo.</p>}
      <p className="small">Le foto originali restano nella galleria del telefono, l'app conserva solo le miniature.</p>

      <h2 className="section-title">Versione</h2>
      <div className="list">
        <div><span className="k">Versione</span><b>{versionLabel()}</b></div>
        <div><span className="k">Pubblicata</span><span>{buildLabel()}</span></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn ghost" disabled={!!updating} onClick={() => void searchUpdate()}>
          {updating === 'controllo' ? 'Controllo…' : updating === 'installo' ? 'Installo…' : 'Cerca aggiornamenti'}
        </button>
      </div>
      {updating === 'controllo' && <p className="small" role="status">Controllo se c'è una versione nuova…</p>}
      {update.text && (
        <p className="small" role="status">
          {update.text}
          {/* Rimedio se l'app sembra bloccata: riparte scaricando tutto dalla
              rete. ⚠️ Mai senza rete: si toglierebbe la copia offline. */}
          {update.retry && navigator.onLine && (
            <>
              {' '}
              <button className="small-link" onClick={() => void forceUpdate()}>Ricarica comunque</button>
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** Il nome di chi usa l'app, per chi segue i suoi viaggi condivisi (profile.ts). */
function TravelerPage({ go }: { go: (r: Route) => void }) {
  const profile = useProfile()
  const [name, setName] = useState(profile.name ?? '')
  const [saved, setSaved] = useState(false)
  const changed = name.trim() !== (profile.name ?? '')

  return (
    <div className="page">
      <Bar title="Il viaggiatore" back={() => go({ name: 'settings' })} />
      <form
        className="traveler-form"
        onSubmit={(e) => {
          e.preventDefault()
          setProfile({ name })
          setSaved(true)
          // I viaggi già condivisi ricevono il nome nuovo.
          void pushAll()
        }}
      >
        <label className="small" htmlFor="traveler-name">Il tuo nome</label>
        <input
          id="traveler-name"
          className="field"
          placeholder="Es. Alex"
          maxLength={40}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setSaved(false)
          }}
        />
        <button className="btn" type="submit" disabled={!changed}>Salva</button>
      </form>
      {saved && <p className="small" role="status">Salvato.</p>}
      <p className="small">
        Chi segue i viaggi che condividi in diretta li vede come «Viaggio di {name.trim() || 'Alex'}». Il nome lascia il telefono solo con i viaggi condivisi, cifrato come il resto del viaggio.
      </p>
    </div>
  )
}

/** Distanza e tempo con cui le foto si raggruppano in tappe (grouping.ts). */
function GroupingPage({ go }: { go: (r: Route) => void }) {
  const g = useGrouping()
  const [radius, setRadius] = useState(String(g.radiusM))
  const [gap, setGap] = useState(String(g.gapMin))
  const [saved, setSaved] = useState(false)
  const changed = Number(radius) !== g.radiusM || Number(gap) !== g.gapMin
  const isDefault = g.radiusM === DEFAULT_GROUPING.radiusM && g.gapMin === DEFAULT_GROUPING.gapMin

  return (
    <div className="page">
      <Bar title="Tappe" back={() => go({ name: 'settings' })} />
      <p className="small">
        Una foto entra nella stessa tappa delle altre se è stata scattata vicino e poco dopo. Se ti sposti di più, o passa più tempo, comincia una tappa nuova.
      </p>
      <form
        className="traveler-form"
        onSubmit={(e) => {
          e.preventDefault()
          setGrouping({ radiusM: Number(radius), gapMin: Number(gap) })
          // Valori fuori dai limiti tornano dentro: le caselle mostrano quelli salvati.
          const next = getGrouping()
          setRadius(String(next.radiusM))
          setGap(String(next.gapMin))
          setSaved(true)
        }}
      >
        <label className="small" htmlFor="grp-radius">Distanza massima dal centro della tappa, in metri</label>
        <input id="grp-radius" className="field" type="number" inputMode="numeric" min={RADIUS_LIMITS.min} max={RADIUS_LIMITS.max} value={radius} onChange={(e) => { setRadius(e.target.value); setSaved(false) }} />
        <label className="small" htmlFor="grp-gap">Tempo massimo fra una foto e la tappa, in minuti</label>
        <input id="grp-gap" className="field" type="number" inputMode="numeric" min={GAP_LIMITS.min} max={GAP_LIMITS.max} value={gap} onChange={(e) => { setGap(e.target.value); setSaved(false) }} />
        <button className="btn" type="submit" disabled={!changed || !radius || !gap}>Salva</button>
        {!isDefault && (
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setGrouping(DEFAULT_GROUPING)
              setRadius(String(DEFAULT_GROUPING.radiusM))
              setGap(String(DEFAULT_GROUPING.gapMin))
              setSaved(true)
            }}
          >
            Torna a {DEFAULT_GROUPING.radiusM} m e {DEFAULT_GROUPING.gapMin} minuti
          </button>
        )}
      </form>
      {saved && <p className="small" role="status">Salvato.</p>}
      <p className="small">
        Vale per le foto che aggiungi da ora in poi: le tappe già fatte restano come sono. Distanza da {RADIUS_LIMITS.min} a {RADIUS_LIMITS.max} m, tempo da {GAP_LIMITS.min} minuti a 24 ore. Le scelte entrano nel backup completo.
      </p>
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
          <button key={c} className={`swatch${countryColor.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ background: c }} aria-label={colorName(c)} aria-pressed={countryColor.toLowerCase() === c.toLowerCase()} onClick={() => setCountryColor(c)} />
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
  const [ask, setAsk] = useState<ParsedImport>()
  // Import in corso: un backup completo con le miniature a 1080 px può pesare
  // decine di MB e il telefono ci mette un po' (2/11/2026: senza avviso
  // sembrava che non succedesse niente).
  const [importing, setImporting] = useState(false)
  // Domanda, avviso e risultato stanno sotto il pulsante: sul telefono possono
  // finire fuori vista, quindi la pagina ci scorre da sola.
  const outcome = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Scorrimento immediato: quello «morbido» nel browser di prova a volte non partiva.
    if (ask || msg || importing) outcome.current?.scrollIntoView({ block: 'center' })
  }, [ask, msg, importing])

  async function finish(parsed: ParsedImport, withShares: boolean) {
    setImporting(true)
    const r = await applyImport(parsed, withShares).finally(() => setImporting(false))
    void geocodePending()
    void routesPending()
    if (!r.photos && !r.newTrips && !r.filled) return 'Avevi già tutto, non ho aggiunto niente.'
    const names = r.trips.length > 1 ? `${r.trips.slice(0, -1).join(', ')} e ${r.trips.at(-1)}` : r.trips[0]
    return `Hai importato ${names}. ${r.photos ? `${plural(r.photos, 'foto nuova', 'foto nuove')}` : 'Nessuna foto nuova'}${r.present ? `, ${plural(r.present, 'altra', 'altre')} c'${r.present === 1 ? 'era' : 'erano'} già` : ''}.`
  }

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
      <button className="btn" disabled={working || !trips} onClick={() => void run(async () => ((await runBackup()) ? 'Backup fatto.' : undefined))}>
        Fai il backup completo
      </button>
      <p className="small">Il backup contiene anche i link dei viaggi che condividi. Tienilo per te.</p>

      <h2 className="section-title">Esporta alcuni viaggi</h2>
      <p className="small">Per passare qualche viaggio a qualcuno. Più viaggi finiscono in un unico file.</p>
      <button className="btn ghost" disabled={working || !trips} onClick={() => setChoosing(true)}>
        Scegli i viaggi da esportare
      </button>
      {choosing && (
        <ChooseTrips
          onClose={() => setChoosing(false)}
          onExport={(ids, lite) => {
            setChoosing(false)
            const label = ids.length === 1 ? '1 viaggio' : `${ids.length} viaggi`
            void run(async () => ((await shareExport(label, (p) => exportTrips(ids, p, lite))) ? `Esportat${ids.length === 1 ? 'o 1 viaggio' : `i ${ids.length} viaggi`}.` : undefined))
          }}
        />
      )}

      {/* Riguarda gli export, quindi sta sopra il ripristino (scelta dell'utente). */}
      <p className="small">I file contengono viaggi, tappe, note, diario, percorsi e miniature.</p>

      <h2 className="section-title">Ripristino</h2>
      <p className="small">Puoi importare un singolo viaggio o un backup completo, anche fatto su un altro telefono. Se un viaggio c'è già, si aggiunge solo quello che manca, senza cambiare il resto.</p>
      <p className="small">Per unire il viaggio di chi era con te a uno dei tuoi, apri il tuo viaggio e scegli ⋯ › «Unisci un viaggio ricevuto».</p>
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
              setImporting(true)
              const parsed = await readImport(file).finally(() => setImporting(false))
              // Un backup con condivisioni in diretta: si chiede prima (sicurezza, backup.ts).
              if (parsed.shareTrips.length) return void setAsk(parsed)
              return finish(parsed, false)
            })
          }}
        />
      </label>
      <div ref={outcome}>
      {importing && (
        <div className="note-box" style={{ marginTop: 12 }} role="status">
          Leggo il file. Se è un backup grande può volerci un po', tieni l'app aperta.
        </div>
      )}
      {ask && (
        <div className="note-box warm" style={{ marginTop: 12 }} role="alert">
          <p style={{ marginTop: 0 }}>
            Questo backup riprende anche la condivisione in diretta di {ask.shareTrips.map((n) => `«${n}»`).join(', ')}. Riprendila solo se il backup è tuo.
          </p>
          <div className="stack">
            <button className="btn" disabled={working} onClick={() => { const p = ask; setAsk(undefined); void run(() => finish(p, true)) }}>
              Il backup è mio, riprendi la condivisione
            </button>
            <button className="btn ghost" disabled={working} onClick={() => { const p = ask; setAsk(undefined); void run(() => finish(p, false)) }}>
              Importa senza condivisione
            </button>
          </div>
        </div>
      )}
      {msg && <div className="note-box" style={{ marginTop: 12 }} role="status">{msg}</div>}
      </div>
    </div>
  )
}

/** Elenco dei viaggi con una casella ciascuno; dal più recente, come in Home. */
function ChooseTrips({ onClose, onExport }: { onClose: () => void; onExport: (ids: string[], lite: boolean) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Leggero per WhatsApp (predefinito) o qualità piena per unire i viaggi (scelta dell'utente, 1/11/2026).
  const [lite, setLite] = useState(true)
  const key = [...picked].sort().join()
  const size = useLiveQuery(() => (picked.size ? estimateExport([...picked]) : undefined), [key])
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
      <h3 className="section-title">Foto</h3>
      <div className="list pick-list">
        <label className="pick">
          <input type="radio" name="export-quality" checked={lite} onChange={() => setLite(true)} />
          <span className="pick-text">
            <b>Leggere</b>
            <span className="k">Per mandarle su WhatsApp{size ? `, circa ${fmtBytes(size.lite)}` : ''}</span>
          </span>
        </label>
        <label className="pick">
          <input type="radio" name="export-quality" checked={!lite} onChange={() => setLite(false)} />
          <span className="pick-text">
            <b>Qualità piena</b>
            <span className="k">Per chi unisce il viaggio al suo{size ? `, circa ${fmtBytes(size.full)}` : ''}</span>
          </span>
        </label>
      </div>
      <div className="stack">
        <button className="btn" disabled={picked.size === 0} onClick={() => onExport([...picked], lite)}>
          {picked.size === 0 ? 'Scegli almeno un viaggio' : `Esporta ${plural(picked.size, 'viaggio', 'viaggi')}`}
        </button>
      </div>
    </Sheet>
  )
}
