import { useState } from 'react'
import { db, deletePhoto, mergeStops, splitStop, stopTitle, type Photo, type Stop } from './db'
import { fmtDateTime, fmtTime, plural } from './format'
import { geocodePending } from './geocode'
import { IconMap, IconScissors, IconShare, IconTrash } from './icons'
import Sheet from './Sheet'
import MealSheet from './MealSheet'
import { shareStop, stopTarget } from './share'
import MapsChooser from './MapsChooser'
import { thumbUrl } from './thumbUrl'
import { describeWeather, weatherPending } from './weather'
import { routesPending } from './routing'
import { useProfile } from './profile'
import { mealVenue, rateMeal, sameVenue } from './venues'

interface Props {
  stop: Stop
  photos: Photo[]
  color: string
  /** Viaggio seguito da un altro telefono (sync.ts): si guarda e basta. */
  readOnly?: boolean
  /** Tappe vicine nella cronologia, per unire. */
  prev?: Stop
  next?: Stop
  onClose: () => void
  /** Apre un'altra tappa (dopo un'unione o una divisione). */
  onOpen: (stopId: string) => void
}

type Ask = { kind: 'delete'; photo: Photo } | { kind: 'split'; photo: Photo } | { kind: 'merge'; other: Stop; into: 'prev' | 'next' } | { kind: 'meal'; photo?: Photo } | { kind: 'maps' }

export default function StopSheet({ stop, photos, color, readOnly, prev, next, onClose, onOpen }: Props) {
  const [note, setNote] = useState(stop.note ?? '')
  const [renaming, setRenaming] = useState<string>()
  const [ask, setAsk] = useState<Ask>()
  const [msg, setMsg] = useState<string>()
  // Di chi è la foto: solo per quelle arrivate da un'altra persona (merge.ts).
  const me = useProfile().name
  /**
   * «Modifica tappa»: forbici, cestino e «Unisci» restano nascosti finché non si
   * chiedono (richiesta dell'utente, 30/10/2026): sono azioni rare e pesanti,
   * non devono stare sotto il pollice a ogni apertura.
   */
  const [editing, setEditing] = useState(false)

  const saveNote = () => {
    const clean = note.trim()
    if (readOnly) return
    if (clean !== (stop.note ?? '')) void db.stops.update(stop.id, { note: clean || undefined })
  }
  const close = () => {
    saveNote()
    onClose()
  }
  const saveName = (value: string | undefined) => {
    const clean = value?.trim()
    void db.stops.update(stop.id, { name: clean || undefined })
    setRenaming(undefined)
  }

  const weather = stop.weather && describeWeather(stop.weather.code)

  return (
    <Sheet onClose={close}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {readOnly ? (
            <h2>{stopTitle(stop)}</h2>
          ) : renaming === undefined ? (
            <h2 onClick={() => setRenaming(stop.name ?? stop.place ?? '')} style={{ cursor: 'text' }}>
              {stopTitle(stop)} <span className="edit-hint">✎</span>
            </h2>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                saveName(renaming)
              }}
            >
              <input className="field" autoFocus value={renaming} maxLength={80} placeholder={stop.place ?? 'Nome della tappa'} onChange={(e) => setRenaming(e.target.value)} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" type="submit">Salva</button>
                {stop.name && (
                  <button className="btn ghost" type="button" onClick={() => saveName(undefined)}>
                    Nome automatico
                  </button>
                )}
              </div>
              {stop.place && <p className="small">Nome automatico: {stop.place}</p>}
            </form>
          )}
          <div className="meta">
            <span className="dot" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 6 }} />
            {fmtDateTime(stop.first)}
            {stop.country ? ` · ${stop.country}` : ''}
          </div>
          {weather && stop.weather && (
            <div className="meta">
              {weather.icon} {stop.weather.temp}° · {weather.label}
            </div>
          )}
        </div>
        {readOnly ? (
          stop.star && <span className="star-btn on" aria-label="Posto speciale">★</span>
        ) : (
        <button
          className={`star-btn${stop.star ? ' on' : ''}`}
          aria-label={stop.star ? 'Togli dai posti speciali' : 'Segna come posto speciale'}
          onClick={() => void db.stops.update(stop.id, { star: !stop.star || undefined })}
        >
          {stop.star ? '★' : '☆'}
        </button>
        )}
      </div>

      <div className="gallery">
        {photos.map((p, i) => (
          <figure key={p.id} className="shot" style={{ margin: 0, ['--r' as string]: p.width / p.height }}>
            <img src={thumbUrl(p)} alt={`Foto delle ${fmtTime(p.taken)}`} />
            <figcaption className="cap">
              <span>
                {fmtTime(p.taken)}
                {p.alt != null ? ` · ${p.alt} m` : ''}
                {p.by && p.by !== me ? ` · di ${p.by}` : ''}
              </span>
              <span>
                {/* La foto del piatto: da qui si sceglie il locale, cercando attorno a
                    questa foto. Un locale per tappa: scelto quello, le 🍽️ spariscono
                    e tornano se lo si toglie. */}
                {!readOnly && !editing && !stop.meal && (
                  <button className="meal-icon" aria-label="Ho mangiato qui: scegli il locale" onClick={() => setAsk({ kind: 'meal', photo: p })}>
                    🍽️
                  </button>
                )}
                {editing && i > 0 && (
                  <button aria-label="Dividi la tappa da questa foto" onClick={() => setAsk({ kind: 'split', photo: p })}>
                    <IconScissors />
                  </button>
                )}
                {editing && (
                  <button aria-label="Togli questa foto" onClick={() => setAsk({ kind: 'delete', photo: p })}>
                    <IconTrash />
                  </button>
                )}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* «Ho mangiato qui»: il locale, con un voto. */}
      {stop.meal ? (
        <div className="meal-box">
          <div className="meal-head">
            <span>
              <b>🍽️ {stop.meal.name}</b>
              {stop.meal.kind && <span className="k">{stop.meal.kind}</span>}
            </span>
            {!readOnly && <button className="small-link" onClick={() => setAsk({ kind: 'meal', photo: photos.find((p) => p.id === stop.meal?.photoId) })}>Cambia</button>}
          </div>
          {readOnly ? (
            stop.meal.rating ? <div className="meal-stars">{'★'.repeat(stop.meal.rating)}</div> : null
          ) : (
          <div className="rating" role="radiogroup" aria-label="Voto">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={stop.meal?.rating === n}
                aria-label={`${n} su 5`}
                className={(stop.meal?.rating ?? 0) >= n ? 'on' : ''}
                // Toccare il voto già dato lo toglie. Vale per tutte le visite di questo locale (venues.ts).
                onClick={() => void rateMeal(mealVenue({ ...stop, meal: stop.meal! }), stop.meal?.rating === n ? undefined : n)}
              >
                ★
              </button>
            ))}
            <button className="small-link" style={{ marginLeft: 'auto' }} onClick={() => void db.stops.update(stop.id, { meal: undefined })}>
              Togli
            </button>
          </div>
          )}
        </div>
      ) : readOnly ? null : (
        <p className="small meal-hint">Hai mangiato qui? Tocca 🍽️ sotto la foto del piatto per scegliere il locale.</p>
      )}

      <div className="stack">
        {readOnly ? (
          stop.note && <p className="note-box" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{stop.note}</p>
        ) : (
          <textarea className="field" aria-label="Nota" placeholder="Una nota su questo posto…" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
        )}
        <div className="row">
          {/* Chi segue non condivide le tappe di un viaggio altrui (richiesta dell'utente, 30/10/2026). */}
          {!readOnly && (
            <button
              className="btn ghost"
              onClick={async () => {
                const r = await shareStop({ ...stop, note }, photos[0])
                if (r === 'copied') setMsg('Link copiato negli appunti')
              }}
            >
              <IconShare /> Condividi
            </button>
          )}
          <button className="btn ghost" onClick={() => setAsk({ kind: 'maps' })}>
            <IconMap /> Apri in mappe
          </button>
        </div>
        {msg && <p className="small" role="status">{msg}</p>}
        {!readOnly && (
          <button className={`btn ${editing ? '' : 'ghost '}small-btn`} onClick={() => setEditing(!editing)}>
            {editing ? 'Fine modifica' : '✎ Modifica tappa'}
          </button>
        )}
        {editing && (
          <p className="small" style={{ margin: 0 }}>
            Sotto ogni foto ✂ divide la tappa da quella foto in poi, il cestino la toglie dall'app (resta in galleria).
          </p>
        )}
        {editing && (prev || next) && (
          <div className="row">
            {prev && (
              <button className="btn ghost small-btn" onClick={() => setAsk({ kind: 'merge', other: prev, into: 'prev' })}>
                ↑ Unisci alla precedente
              </button>
            )}
            {next && (
              <button className="btn ghost small-btn" onClick={() => setAsk({ kind: 'merge', other: next, into: 'next' })}>
                ↓ Unisci alla successiva
              </button>
            )}
          </div>
        )}
        <p className="small">
          {plural(photos.length, 'foto', 'foto')}
        </p>
      </div>

      {ask?.kind === 'meal' && <MealSheet stop={stop} photo={ask.photo} onClose={() => setAsk(undefined)} />}
      {ask?.kind === 'maps' && <MapsChooser target={stopTarget(stop)} onClose={() => setAsk(undefined)} />}

      {ask?.kind === 'delete' && (
        <Sheet onClose={() => setAsk(undefined)}>
          <h2>Togliere questa foto?</h2>
          <p className="small">Si cancella solo la miniatura nell'app. La foto originale resta nella galleria.</p>
          <div className="stack">
            <button
              className="btn danger"
              onClick={async () => {
                const last = photos.length === 1
                await deletePhoto(ask.photo.id)
                setAsk(undefined)
                if (last) onClose()
              }}
            >
              Togli la foto
            </button>
            <button className="btn ghost" onClick={() => setAsk(undefined)}>Annulla</button>
          </div>
        </Sheet>
      )}

      {ask?.kind === 'split' && (
        <Sheet onClose={() => setAsk(undefined)}>
          <h2>Dividere la tappa?</h2>
          <p className="small">
            La foto delle {fmtTime(ask.photo.taken)} e quelle scattate dopo diventano una tappa nuova, con il suo nome e il suo meteo.
          </p>
          <div className="stack">
            <button
              className="btn"
              onClick={async () => {
                saveNote()
                const id = await splitStop(stop.id, ask.photo.id)
                setAsk(undefined)
                void geocodePending()
                void weatherPending()
                void routesPending()
                if (id) onOpen(id)
              }}
            >
              Dividi la tappa
            </button>
            <button className="btn ghost" onClick={() => setAsk(undefined)}>Annulla</button>
          </div>
        </Sheet>
      )}

      {ask?.kind === 'merge' && (() => {
        const merge = async (keep: 'into' | 'from') => {
          saveNote()
          await mergeStops(ask.other.id, stop.id, keep)
          setAsk(undefined)
          void weatherPending()
          void routesPending()
          onOpen(ask.other.id)
        }
        // Due locali diversi: ne resta uno solo, lo sceglie l'utente (R3).
        const mine = stop.meal
        const theirs = ask.other.meal
        const twoMeals = !!mine && !!theirs && !sameVenue(mealVenue({ ...stop, meal: mine }), mealVenue({ ...ask.other, meal: theirs }))
        return (
          <Sheet onClose={() => setAsk(undefined)}>
            <h2>Unire le tappe?</h2>
            <p className="small">
              Le foto di «{stopTitle(stop)}» passano a «{stopTitle(ask.other)}», con note e stellina. Si può tornare indietro dividendo la tappa.
            </p>
            {twoMeals && <p className="small">Tutte e due le tappe hanno un locale, ne resta uno solo. Scegli quale tenere, l'altro si toglie col suo voto.</p>}
            <div className="stack">
              {twoMeals ? (
                <>
                  <button className="btn" onClick={() => void merge('into')}>
                    Tieni «{theirs.name}»
                  </button>
                  <button className="btn" onClick={() => void merge('from')}>
                    Tieni «{mine.name}»
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => void merge('into')}>
                  Unisci le tappe
                </button>
              )}
              <button className="btn ghost" onClick={() => setAsk(undefined)}>Annulla</button>
            </div>
          </Sheet>
        )
      })()}
    </Sheet>
  )
}
