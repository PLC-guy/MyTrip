import { useEffect, useRef, useState, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { cssColor } from './theme'

export interface MapPin {
  id: string
  lat: number
  lon: number
  color: string
  /** Miniatura: se manca, il punto è solo un pallino colorato. */
  img?: string
  count?: number
  star?: boolean
}

export interface MapLine {
  id: string
  color: string
  points: [number, number][]
  /** Tratto in aereo: tratteggio lungo invece dei puntini. */
  flight?: boolean
  /** Linea dritta perché il percorso vero non si conosce (treno, barca, non trovato): tratteggio più leggero. */
  straight?: boolean
  /** Icona del mezzo, disegnata a metà del tratto. */
  icon?: string
}

interface Props {
  pins: MapPin[]
  lines: MapLine[]
  /** Quando cambia, la mappa si riadatta per mostrare tutti i punti. */
  fitKey: string
  focusId?: string
  onPin?: (id: string) => void
  tall?: boolean
  /** Zoom massimo quando la mappa si adatta ai punti (15 = vie; 4 = paesi). */
  fitMaxZoom?: number
  /** Mappa del mondo (pagina Paesi): proporzioni larghe e margini minimi, così il mondo intero riempie il riquadro. */
  world?: boolean
  /** Punti da inquadrare senza disegnarli (pagina Paesi). */
  fitPoints?: { lat: number; lon: number }[]
  /** Paesi da colorare (codici ISO), per la mappa dei paesi visitati. */
  countries?: { codes: string[]; color: string }
  /** Contenuto sovrapposto alla mappa (es. la didascalia dell'itinerario animato). */
  children?: ReactNode
}

/**
 * Mappa vettoriale di OpenFreeMap: gratuita, senza chiave.
 * ⚠️ Vettoriale e non a immagini apposta: i nomi li disegna l'app, quindi si
 * possono mostrare in italiano. Con le tile a immagini di OpenStreetMap i nomi
 * erano nella lingua del posto (in Thailandia, illeggibili).
 */
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/** Nome italiano, altrimenti la trascrizione in alfabeto latino, altrimenti quello locale. */
const LABEL: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'name:it'], ['get', 'name:latin'], ['get', 'name']]

function localize(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== 'symbol') continue
    const field = map.getLayoutProperty(layer.id, 'text-field')
    // Solo le etichette con un nome: le sigle delle strade (`ref`) restano.
    if (field && JSON.stringify(field).includes('name')) map.setLayoutProperty(layer.id, 'text-field', LABEL)
  }
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
// Colori del tema attivo, letti a ogni disegno: la mappa si ricrea cambiando schermata.
const ink = () => cssColor('--ink', '#1C2B24')

/**
 * PUNTATORI
 *
 * Ogni tappa ha un pallino nel punto ESATTO dello scatto, sempre visibile: il
 * percorso finisce sempre su un punto. Sopra c'è la miniatura con una punta
 * che indica il pallino.
 *
 * ⚠️ Le miniature sono un livello «symbol» della mappa e non elementi HTML:
 * così la mappa nasconde da sola quelle che si sovrapporrebbero e le fa
 * ricomparire avvicinandosi, come l'app Foto. Con gli elementi HTML (0.4.x)
 * restavano tutte visibili e riempivano la mappa. Hanno la precedenza la tappa
 * aperta, poi le ★, poi quelle con più foto.
 */
const PIN = 44 // lato della miniatura, in punti
const TIP = 7 // altezza della punta
const RATIO = 2 // densità del disegno (schermi retina)

const pinImageId = (p: MapPin) => `p|${p.img}|${p.color}|${p.star ? 1 : 0}|${p.count ?? 1}`
const legImageId = (icon: string) => `t|${icon}`

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Disegna la miniatura con bordo, punta, ★ e numero di foto. */
async function drawPin(p: MapPin): Promise<ImageData> {
  const img = new Image()
  img.src = p.img!
  await img.decode()
  const s = RATIO
  const canvas = document.createElement('canvas')
  canvas.width = PIN * s
  canvas.height = (PIN + TIP) * s
  const ctx = canvas.getContext('2d')!
  ctx.scale(s, s)
  // Bordo e punta
  ctx.fillStyle = p.color
  roundRect(ctx, 0, 0, PIN, PIN, 8)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(PIN / 2 - 6, PIN - 1)
  ctx.lineTo(PIN / 2, PIN + TIP)
  ctx.lineTo(PIN / 2 + 6, PIN - 1)
  ctx.fill()
  // Foto ritagliata al quadrato
  ctx.save()
  roundRect(ctx, 3, 3, PIN - 6, PIN - 6, 6)
  ctx.clip()
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 3, 3, PIN - 6, PIN - 6)
  ctx.restore()
  if (p.count && p.count > 1) {
    ctx.fillStyle = ink()
    roundRect(ctx, PIN - 19, PIN - 16, 16, 13, 6.5)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '700 9px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.count > 99 ? '99' : String(p.count), PIN - 11, PIN - 9.5)
  }
  if (p.star) {
    ctx.fillStyle = cssColor('--saff', '#E3A02B')
    ctx.beginPath()
    ctx.arc(PIN - 7, 7, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '700 10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('★', PIN - 7, 7.5)
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Icona del mezzo: l'emoji su un dischetto chiaro. */
function drawLegIcon(icon: string): ImageData {
  const size = 26
  const s = RATIO
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * s
  const ctx = canvas.getContext('2d')!
  ctx.scale(s, s)
  ctx.fillStyle = cssColor('--bg', '#F5F0E6')
  ctx.strokeStyle = ink()
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.25
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.font = '14px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(icon, size / 2, size / 2 + 1)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export default function MapView({ pins, lines, fitKey, focusId, onPin, tall, world, fitMaxZoom = 15, fitPoints, countries, children }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const loading = useRef(new Set<string>())
  const onPinRef = useRef(onPin)
  onPinRef.current = onPin
  const countriesRef = useRef(countries)
  countriesRef.current = countries
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  const focusRef = useRef(focusId)
  focusRef.current = focusId

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: [10, 30],
      zoom: 1.2,
      attributionControl: { compact: true },
      // Niente rotazione né inclinazione: su una mappa di ricordi confondono.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    m.touchZoomRotate.disableRotation()
    // I crediti della mappa partono chiusi (resta la «i» per aprirli).
    // ⚠️ 'idle' e non 'load': i crediti arrivano con i dati delle tile, dopo il
    // caricamento dello stile, e in quel momento il riquadro si riapre da solo.
    m.once('idle', () => el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))
    m.on('style.load', () => {
      localize(m)
      m.addSource('route', { type: 'geojson', data: EMPTY })
      m.addSource('legs', { type: 'geojson', data: EMPTY })
      m.addSource('pins', { type: 'geojson', data: EMPTY })
      // Due livelli per il percorso: il tratteggio non può cambiare da tratto a tratto.
      const paint: maplibregl.LineLayerSpecification['paint'] = { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 }
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        filter: ['all', ['!', ['get', 'flight']], ['!', ['get', 'straight']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint, 'line-dasharray': [0.1, 2] },
      })
      m.addLayer({
        id: 'route-straight',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'straight'], true],
        paint: { ...paint, 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [2, 2.5] },
      })
      m.addLayer({ id: 'route-flight', type: 'line', source: 'route', filter: ['==', ['get', 'flight'], true], paint: { ...paint, 'line-width': 2, 'line-dasharray': [4, 3] } })
      m.addLayer({
        id: 'pin-dots',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['case', ['get', 'thumb'], 4.5, 6.5],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      // I mezzi cedono il posto alle miniature: livello sotto, quindi piazzato dopo.
      m.addLayer({ id: 'legs', type: 'symbol', source: 'legs', layout: { 'icon-image': ['get', 'icon'], 'icon-padding': 2 } })
      m.addLayer({
        id: 'pin-thumbs',
        type: 'symbol',
        source: 'pins',
        filter: ['has', 'icon'],
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-anchor': 'bottom',
          'icon-offset': [0, -3],
          'icon-padding': 3,
          'symbol-sort-key': ['get', 'rank'],
          'icon-size': 1,
        },
      })
      if (countriesRef.current) void addCountries(m, countriesRef.current)
      setReady(true)
    })
    // Tocco: si cerca un puntatore in un quadrato attorno al dito, perché i
    // pallini sono piccoli da centrare.
    m.on('click', (e) => {
      const { x, y } = e.point
      const hit = m.queryRenderedFeatures(
        [
          [x - 14, y - 14],
          [x + 14, y + 14],
        ],
        { layers: ['pin-thumbs', 'pin-dots'] },
      )[0]
      const id = hit?.properties?.id as string | undefined
      if (id) onPinRef.current?.(id)
    })
    map.current = m
    // Solo in sviluppo: la mappa raggiungibile dalla console, per le prove.
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current!)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  // Percorso e icone dei mezzi.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    ;(m.getSource('route') as maplibregl.GeoJSONSource).setData(toGeoJson(lines))
    for (const l of lines) {
      if (l.icon && !m.hasImage(legImageId(l.icon))) m.addImage(legImageId(l.icon), drawLegIcon(l.icon), { pixelRatio: RATIO })
    }
    // L'icona va a metà del tratto: fra i due estremi se è dritto, sul punto
    // centrale se segue un percorso.
    const legs: Feature[] = lines
      .filter((l) => l.icon && l.points.length >= 2)
      .map((l) => {
        let lat: number
        let lon: number
        if (l.points.length === 2) {
          const [[aLat, aLon], [bLat, bLon]] = l.points
          ;[lat, lon] = [(aLat + bLat) / 2, (aLon + bLon) / 2]
        } else [lat, lon] = l.points[Math.floor(l.points.length / 2)]
        return { type: 'Feature', properties: { icon: legImageId(l.icon!) }, geometry: { type: 'Point', coordinates: [lon, lat] } }
      })
    ;(m.getSource('legs') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: legs })
  }, [lines, ready])

  // Puntatori. Le miniature si disegnano in sottofondo: finché non sono pronte
  // si vede solo il pallino, poi la miniatura compare.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    let cancelled = false
    const refresh = () => {
      if (cancelled) return
      ;(m.getSource('pins') as maplibregl.GeoJSONSource).setData(pinsGeoJson(m, pinsRef.current, focusRef.current))
    }
    refresh()
    for (const p of pins) {
      if (!p.img) continue
      const id = pinImageId(p)
      if (m.hasImage(id) || loading.current.has(id)) continue
      loading.current.add(id)
      void drawPin(p)
        .then((data) => {
          if (!m.hasImage(id)) m.addImage(id, data, { pixelRatio: RATIO })
          refresh()
        })
        .catch(() => {})
        .finally(() => loading.current.delete(id))
    }
    // La tappa aperta un po' più grande, e sempre in vista.
    m.setLayoutProperty('pin-thumbs', 'icon-size', ['case', ['==', ['get', 'id'], focusId ?? ''], 1.25, 1])
    return () => {
      cancelled = true
    }
  }, [pins, focusId, ready])

  // Si riadatta solo quando cambia l'insieme dei punti, non a ogni ridisegno:
  // altrimenti ogni nota o stellina farebbe saltare la vista.
  useEffect(() => {
    const m = map.current
    const points = [...pins, ...(fitPoints ?? [])]
    if (!m || points.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const p of points) bounds.extend([p.lon, p.lat])
    // Più spazio sopra (miniature con la punta, etichette) e sotto (crediti, didascalia).
    const padding = world ? 6 : { top: 80, bottom: 50, left: 40, right: 40 }
    m.fitBounds(bounds, { padding, maxZoom: fitMaxZoom, duration: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  useEffect(() => {
    const m = map.current
    const pin = pins.find((p) => p.id === focusId)
    if (!m || !pin) return
    m.flyTo({ center: [pin.lon, pin.lat], zoom: Math.max(m.getZoom(), 14), duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  return (
    <div className="map-wrap">
      <div ref={el} className={`map${tall ? ' tall' : ''}${world ? ' world' : ''}`} />
      {children}
    </div>
  )
}

/** Punti per la mappa; `icon` solo se la miniatura è già pronta. */
function pinsGeoJson(m: maplibregl.Map, pins: MapPin[], focusId?: string): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => {
      const icon = p.img ? pinImageId(p) : undefined
      // Più basso = piazzato prima = vince sulle altre.
      const rank = p.id === focusId ? 0 : (p.star ? 1000 : 2000) - Math.min(p.count ?? 1, 999)
      return {
        type: 'Feature',
        properties: { id: p.id, color: p.color, thumb: !!p.img, rank, ...(icon && m.hasImage(icon) ? { icon } : {}) },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      }
    }),
  }
}

/**
 * Colora i paesi visitati. I confini vengono da `countries.json` (Natural Earth,
 * semplificato da scripts/build-countries.mjs), caricato solo quando serve.
 */
async function addCountries(m: maplibregl.Map, countries: { codes: string[]; color: string }) {
  const res = await fetch(`${import.meta.env.BASE_URL}countries.json`)
  if (!res.ok || !m.getStyle()) return
  const data = (await res.json()) as FeatureCollection
  m.addSource('countries', { type: 'geojson', data })
  // Sotto le etichette, così i nomi restano leggibili.
  const firstLabel = m.getStyle().layers?.find((l) => l.type === 'symbol')?.id
  m.addLayer(
    {
      id: 'visited',
      type: 'fill',
      source: 'countries',
      filter: ['in', ['get', 'iso'], ['literal', countries.codes]],
      paint: { 'fill-color': countries.color, 'fill-opacity': 0.6 },
    },
    firstLabel,
  )
}

function toGeoJson(lines: MapLine[]): FeatureCollection {
  if (lines.length === 0) return EMPTY
  return {
    type: 'FeatureCollection',
    features: lines
      .filter((l) => l.points.length > 1)
      .map((l) => ({
        type: 'Feature',
        properties: { color: l.color, flight: !!l.flight, straight: !!l.straight },
        // GeoJSON vuole [longitudine, latitudine].
        geometry: { type: 'LineString', coordinates: l.points.map(([lat, lon]) => [lon, lat]) },
      })),
  }
}
