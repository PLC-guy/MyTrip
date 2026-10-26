// Costruisce public/countries.json, i confini dei paesi per la mappa dei paesi
// visitati, dai dati di Natural Earth (pubblico dominio), scala 1:50 milioni.
// Si rilancia solo se si vogliono confini aggiornati:  node scripts/build-countries.mjs
//
// Del file originale (~4 MB) si tengono solo il codice ISO e il nome italiano, e le
// coordinate si arrotondano a 2 decimali (~1 km): per colorare un paese basta.
// ⚠️ ISO_A2_EH e non ISO_A2: in Natural Earth Francia e Norvegia hanno ISO_A2 = -99.
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'countries.json')

const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`Download non riuscito: ${res.status}`)
const src = await res.json()

/** Tolleranza della semplificazione, in gradi (~5 km): invisibile a scala di mondo. */
const TOLERANCE = Number(process.env.TOL ?? 0.05)

/** Douglas-Peucker: toglie i punti che si discostano dalla linea meno della tolleranza. */
function simplify(pts) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = 0
    let at = -1
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const len = Math.hypot(bx - ax, by - ay)
    for (let i = a + 1; i < b; i++) {
      // Anello chiuso (primo punto = ultimo): la "linea" è un punto, si misura la distanza da lì.
      const d = len === 0 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len
      if (d > max) {
        max = d
        at = i
      }
    }
    if (max > TOLERANCE) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

const round = (ring) => {
  const pts = []
  for (const [x, y] of ring) {
    const p = [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
    const last = pts.at(-1)
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
  }
  const simple = simplify(pts)
  // I paesi piccolissimi (Vaticano, Monaco) sparirebbero: si tiene l'originale.
  return simple.length >= 4 ? simple : pts
}
const geometry = (g) =>
  g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: g.coordinates.map(round).filter((r) => r.length >= 4) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map(round).filter((r) => r.length >= 4)).filter((p) => p.length) }

const features = src.features
  .filter((f) => f.properties.ISO_A2_EH && f.properties.ISO_A2_EH !== '-99')
  .map((f) => ({ type: 'Feature', properties: { iso: f.properties.ISO_A2_EH, name: f.properties.NAME_IT }, geometry: geometry(f.geometry) }))

await writeFile(out, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`${features.length} paesi → ${out}`)
