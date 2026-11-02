import { db, newId, stopSummary, type Lodging, type Photo, type Stop, type Trip } from './db'
import { dataUrlToStored, type ExportFile, type PhotoFile } from './backup'
import { distanceM } from './importPhotos'
import { getGrouping } from './grouping'
import { getProfile } from './profile'
import { forgetThumbs } from './thumbUrl'

/**
 * UNISCI DUE VIAGGI (decisioni dell'utente del 1/11/2026)
 *
 * Una direzione sola: l'altra persona esporta il suo viaggio («Esporta alcuni
 * viaggi») e chi lo riceve lo unisce a uno dei suoi dal menu ⋯ del viaggio.
 * Per riavere l'unione si fa lo stesso al contrario.
 *
 * - MAI doppioni: una foto con lo stesso id, o con la stessa impronta (`key`:
 *   data + posizione) di una foto già sul telefono, non entra. Così importa
 *   solo ciò che è nuovo, che il file sia di prima o di dopo un'altra unione.
 * - Foto della stessa scena scattate da due persone sono foto diverse: entrano.
 * - Le tappe del file trovano la loro tappa di qui (stesso id, una foto in
 *   comune, oppure vicine nello spazio e nel tempo come all'import, grouping.ts);
 *   le altre entrano come tappe nuove, con nome, note, locale e mezzo.
 * - Sulla stessa tappa vincono nome, locale e mezzo di chi unisce (riempiono
 *   solo i vuoti); le note si mettono una sotto l'altra con chi le ha scritte.
 *   Lo stesso per diario (per giorno) e pernottamenti (per notte).
 * - Ogni foto nuova ricorda di chi è (`Photo.by`).
 * - Niente si cancella e il viaggio di qui tiene nome, colore e copertina.
 *   I percorsi non si copiano: con tappe nuove in mezzo cambiano, si ricalcolano.
 */

export interface MergePlan {
  target: Trip
  /** Il viaggio del file e il nome di chi l'ha mandato (se l'ha scritto). */
  from: { name: string; by?: string }
  photos: Photo[]
  /** Tappe da scrivere: nuove e di qui aggiornate. */
  stops: Stop[]
  newStops: number
  /** Foto del file che ci sono già. */
  already: number
  /** Valori diversi sulla stessa tappa, giorno o notte. */
  differences: number
  diary?: Record<string, string>
  nights?: Record<string, Lodging>
}

/** Nome con cui firmare una nota: quello del viaggiatore, se c'è. */
const signed = (text: string, by?: string) => (by && !text.startsWith(`${by}:`) ? `${by}: ${text}` : text)

/**
 * Due note sulla stessa cosa. Se una contiene già l'altra (per esempio un file
 * che torna indietro dopo un'unione) si tiene la più lunga; altrimenti una
 * sotto l'altra, la propria per prima.
 */
function joinNotes(mine: string | undefined, theirs: string | undefined, me: string | undefined, by: string | undefined): { text?: string; differs: boolean } {
  const a = mine?.trim()
  const b = theirs?.trim()
  if (!b) return { text: mine, differs: false }
  if (!a) return { text: signed(b, by), differs: false }
  if (a.includes(b)) return { text: mine, differs: false }
  if (b.includes(a)) return { text: theirs, differs: false }
  return { text: `${signed(a, me)}\n\n${signed(b, by)}`, differs: true }
}

/** Prepara l'unione senza scrivere nulla: serve a dire prima cosa succederà. */
export async function planMerge(targetId: string, data: ExportFile, fromTripId: string): Promise<MergePlan> {
  const target = await db.trips.get(targetId)
  const source = data.trips.find((t) => t.id === fromTripId)
  if (!target || !source) throw new Error('Il viaggio non c\'è più.')
  const me = getProfile().name
  const by = data.by
  const { radiusM, gapMin } = getGrouping()

  const fileStops = data.stops.filter((s) => s.tripId === fromTripId).sort((a, b) => a.start - b.start)
  const filePhotos = data.photos.filter((p) => p.tripId === fromTripId)

  // Foto già sul telefono: stesso id o stessa impronta, in qualunque viaggio.
  const byId = new Map((await db.photos.bulkGet(filePhotos.map((p) => p.id))).flatMap((p) => (p ? [[p.id, p] as const] : [])))
  const byKey = new Map((await db.photos.where('key').anyOf(filePhotos.map((p) => p.key)).toArray()).map((p) => [p.key, p] as const))
  const localOf = (p: PhotoFile) => byId.get(p.id) ?? byKey.get(p.key)

  const mine = await db.stops.where('tripId').equals(targetId).toArray()
  const mineById = new Map(mine.map((s) => [s.id, s]))
  const takenStopIds = new Set((await db.stops.bulkGet(fileStops.map((s) => s.id))).flatMap((s) => (s ? [s.id] : [])))
  // Foto (vecchie e nuove) di ogni tappa di qui toccata, per ricalcolarne centro e orari.
  const members = new Map<string, Pick<Photo, 'lat' | 'lon' | 'time' | 'taken'>[]>()
  const membersOf = async (stopId: string) => {
    if (!members.has(stopId)) members.set(stopId, await db.photos.where('stopId').equals(stopId).toArray())
    return members.get(stopId)!
  }

  const out = new Map<string, Stop>()
  const photos: Photo[] = []
  let already = 0
  let differences = 0
  let newStops = 0

  for (const fs of fileStops) {
    const own = filePhotos.filter((p) => p.stopId === fs.id)
    const fresh = own.filter((p) => !localOf(p))
    already += own.length - fresh.length

    // La tappa di qui che corrisponde: stesso id, una foto in comune, o vicina.
    let match = mineById.get(fs.id)
    if (!match) {
      const common = own.map(localOf).find((p) => p?.tripId === targetId)
      if (common) match = mineById.get(common.stopId)
    }
    if (!match) {
      let best = Infinity
      for (const s of mine) {
        const gap = fs.end < s.start ? s.start - fs.end : fs.start > s.end ? fs.start - s.end : 0
        if (gap > gapMin * 60_000) continue
        const d = distanceM(s.lat, s.lon, fs.lat, fs.lon)
        if (d <= radiusM && d < best) {
          best = d
          match = s
        }
      }
    }

    // Il locale punta a una foto: se quella c'era già, ha l'id di qui.
    const dish = fs.meal?.photoId ? filePhotos.find((p) => p.id === fs.meal!.photoId) : undefined
    const meal = fs.meal && { ...fs.meal, photoId: (dish && localOf(dish)?.id) ?? fs.meal.photoId }

    if (match) {
      const cur = out.get(match.id) ?? { ...match }
      const before = JSON.stringify(cur)
      if (cur.name && fs.name && cur.name !== fs.name) differences++
      if (cur.meal && meal && cur.meal.name !== meal.name) differences++
      if (cur.transport && fs.transport && cur.transport !== fs.transport) differences++
      const note = joinNotes(cur.note, fs.note, me, by)
      if (note.differs) differences++
      Object.assign(cur, {
        name: cur.name ?? fs.name,
        meal: cur.meal ?? meal,
        transport: cur.transport ?? fs.transport,
        note: note.text,
        star: cur.star || fs.star || undefined,
        place: cur.place ?? fs.place,
        country: cur.country ?? fs.country,
        countryCode: cur.countryCode ?? fs.countryCode,
      })
      if (fresh.length) {
        const list = await membersOf(match.id)
        list.push(...fresh)
        const summary = stopSummary(list)
        // Se la tappa ora comincia prima, il meteo va richiesto per la nuova ora.
        if (summary.first !== cur.first) Object.assign(cur, { weather: undefined, weatherDone: undefined })
        Object.assign(cur, summary)
      }
      // Solo le tappe cambiate: se non cambia nulla, non c'è niente da unire.
      if (out.has(match.id) || JSON.stringify(cur) !== before) out.set(match.id, cur)
      photos.push(...fresh.map((p) => ({ ...p, tripId: targetId, stopId: match!.id, by: p.by ?? by, thumb: dataUrlToStored(p.thumb) })))
    } else if (fresh.length) {
      const id = takenStopIds.has(fs.id) ? newId() : fs.id
      out.set(id, { ...fs, ...stopSummary(fresh), id, tripId: targetId, meal, note: fs.note && signed(fs.note, by) })
      newStops++
      photos.push(...fresh.map((p) => ({ ...p, tripId: targetId, stopId: id, by: p.by ?? by, thumb: dataUrlToStored(p.thumb) })))
    }
  }

  // Diario e pernottamenti: per giorno, con le stesse regole delle tappe.
  let diary: Record<string, string> | undefined
  for (const [day, text] of Object.entries(source.diary ?? {})) {
    const cur = (diary ?? target.diary)?.[day]
    const joined = joinNotes(cur, text, me, by)
    if (joined.differs) differences++
    if (joined.text !== cur) diary = { ...(diary ?? target.diary), [day]: joined.text ?? '' }
  }
  let nights: Record<string, Lodging> | undefined
  for (const [day, lodging] of Object.entries(source.nights ?? {})) {
    const cur = target.nights?.[day]
    if (cur) {
      if (cur.name !== lodging.name) differences++
    } else nights = { ...(nights ?? target.nights), [day]: lodging }
  }

  return { target, from: { name: source.name, by }, photos, stops: [...out.values()], newStops, already, differences, diary, nights }
}

/** Scrive l'unione preparata da `planMerge`. */
export async function applyMerge(plan: MergePlan): Promise<void> {
  forgetThumbs(plan.photos.map((p) => p.id))
  await db.transaction('rw', [db.trips, db.stops, db.photos], async () => {
    if (plan.diary || plan.nights) await db.trips.update(plan.target.id, { ...(plan.diary ? { diary: plan.diary } : {}), ...(plan.nights ? { nights: plan.nights } : {}) })
    await db.stops.bulkPut(plan.stops)
    await db.photos.bulkAdd(plan.photos)
  })
}
