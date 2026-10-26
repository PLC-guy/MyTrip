import { useEffect, useRef, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'

export interface MapPin {
  id: string
  lat: number
  lon: number
  color: string
  /** Miniatura: se manca, il punto è un pallino colorato. */
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

export default function MapView({ pins, lines, fitKey, focusId, onPin, tall, fitMaxZoom = 15, fitPoints, countries, children }: Props) {
  const icons = useRef<maplibregl.Marker[]>([])
  const countriesRef = useRef(countries)
  countriesRef.current = countries
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const onPinRef = useRef(onPin)
  onPinRef.current = onPin
  const linesRef = useRef(lines)
  linesRef.current = lines

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
    // I crediti della mappa partono chiusi (resta la «i» per aprirli): aperti
    // coprirebbero il fondo della mappa sul telefono.
    // ⚠️ 'idle' e non 'load': i crediti arrivano con i dati delle tile, dopo il
    // caricamento dello stile, e in quel momento il riquadro si riapre da solo.
    m.once('idle', () => el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))
    m.on('style.load', () => {
      localize(m)
      m.addSource('route', { type: 'geojson', data: toGeoJson(linesRef.current) })
      // Due livelli e non uno: il tratteggio non può cambiare da tratto a tratto.
      const paint: maplibregl.LineLayerSpecification['paint'] = { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 }
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        filter: ['!', ['get', 'flight']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint, 'line-dasharray': [0.1, 2.2] },
      })
      m.addLayer({
        id: 'route-flight',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'flight'], true],
        layout: { 'line-cap': 'butt' },
        paint: { ...paint, 'line-width': 2, 'line-dasharray': [4, 3] },
      })
      if (countriesRef.current) void addCountries(m, countriesRef.current)
    })
    map.current = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current!)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const source = m?.getSource('route') as maplibregl.GeoJSONSource | undefined
    source?.setData(toGeoJson(lines))
    // Icone dei mezzi a metà di ogni tratto.
    for (const mk of icons.current) mk.remove()
    icons.current = []
    if (!m) return
    for (const l of lines) {
      if (!l.icon || l.points.length !== 2) continue
      const [[aLat, aLon], [bLat, bLon]] = l.points
      const node = document.createElement('div')
      node.className = 'transport-pin'
      node.textContent = l.icon
      icons.current.push(new maplibregl.Marker({ element: node }).setLngLat([(aLon + bLon) / 2, (aLat + bLat) / 2]).addTo(m))
    }
  }, [lines])

  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const mk of markers.current) mk.remove()
    markers.current = pins.map((pin) => {
      const node = document.createElement('div')
      if (pin.img) {
        node.className = `pin${pin.star ? ' star' : ''}${pin.id === focusId ? ' focus' : ''}`
        node.style.setProperty('--c', pin.color)
        const img = document.createElement('img')
        img.src = pin.img
        img.alt = ''
        node.append(img)
        if (pin.count && pin.count > 1) {
          const n = document.createElement('span')
          n.className = 'pin-n'
          n.textContent = String(pin.count)
          node.append(n)
        }
      } else {
        node.className = 'dot-pin'
        node.style.background = pin.color
      }
      node.addEventListener('click', (e) => {
        e.stopPropagation()
        onPinRef.current?.(pin.id)
      })
      const marker = new maplibregl.Marker({ element: node }).setLngLat([pin.lon, pin.lat]).addTo(m)
      if (pin.id === focusId) node.style.zIndex = '10'
      return marker
    })
  }, [pins, focusId])

  // Si riadatta solo quando cambia l'insieme dei punti, non a ogni ridisegno:
  // altrimenti ogni nota o stellina farebbe saltare la vista.
  useEffect(() => {
    const m = map.current
    const points = [...pins, ...(fitPoints ?? [])]
    if (!m || points.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const p of points) bounds.extend([p.lon, p.lat])
    // Più spazio sopra (etichetta del viaggio, pulsante ▶) e sotto (crediti, didascalia).
    m.fitBounds(bounds, { padding: { top: 70, bottom: 60, left: 45, right: 45 }, maxZoom: fitMaxZoom, duration: 0 })
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
      <div ref={el} className={`map${tall ? ' tall' : ''}`} />
      {children}
    </div>
  )
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
        properties: { color: l.color, flight: !!l.flight },
        // GeoJSON vuole [longitudine, latitudine].
        geometry: { type: 'LineString', coordinates: l.points.map(([lat, lon]) => [lon, lat]) },
      })),
  }
}
