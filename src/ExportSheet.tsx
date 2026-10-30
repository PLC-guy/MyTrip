import { IconShare } from './icons'
import { fmtBytes } from './format'
import Sheet from './Sheet'
import { cancelReady, shareReady, useExportState } from './exportFlow'

/** Il foglio dell'export: avanzamento mentre si prepara, poi «Condividi» (vedi exportFlow.ts). */
export default function ExportSheet() {
  const s = useExportState()
  if (s.phase === 'idle') return null
  if (s.phase === 'preparing') {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0
    return (
      <Sheet onClose={() => {}} locked>
        <h2>Preparo il file…</h2>
        <p className="small">{s.label}{s.total ? ` · ${s.done} di ${s.total} foto` : ''}</p>
        <div className="progress">{s.total ? <div style={{ width: `${pct}%` }} /> : <div className="indeterminate" />}</div>
      </Sheet>
    )
  }
  return (
    <Sheet onClose={cancelReady}>
      <h2>Il file è pronto</h2>
      <p className="small">
        {s.label} · {fmtBytes(s.file.size)}
      </p>
      <div className="stack">
        <button className="btn" onClick={() => void shareReady()}>
          <IconShare /> Condividi
        </button>
        <button className="btn ghost" onClick={cancelReady}>
          Annulla
        </button>
      </div>
    </Sheet>
  )
}
