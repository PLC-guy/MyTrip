import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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
}

interface Props {
  pins: MapPin[]
  lines: MapLine[]
  /** Quando cambia, la mappa si riadatta per mostrare tutti i punti. */
  fitKey: string
  focusId?: string
  onPin?: (id: string) => void
  tall?: boolean
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

export default function MapView({ pins, lines, fitKey, focusId, onPin, tall }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const onPinRef = useRef(onPin)
  onPinRef.current = onPin

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, attributionControl: true, worldCopyJump: true })
    // crossOrigin: richieste CORS, così il service worker può tenerle per l'uso offline.
    L.tileLayer(TILES, { maxZoom: 19, crossOrigin: true, attribution: ATTRIBUTION }).addTo(m)
    m.attributionControl.setPrefix(false)
    m.setView([30, 10], 2)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current!)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const group = layer.current
    if (!group) return
    group.clearLayers()
    for (const line of lines) {
      if (line.points.length < 2) continue
      L.polyline(line.points, { color: line.color, weight: 3, opacity: 0.85, dashArray: '2 8', lineCap: 'round' }).addTo(group)
    }
    for (const pin of pins) {
      const marker = pin.img
        ? L.marker([pin.lat, pin.lon], {
            icon: L.divIcon({
              className: '',
              iconSize: [46, 46],
              iconAnchor: [23, 23],
              html: `<div class="pin${pin.star ? ' star' : ''}${pin.id === focusId ? ' focus' : ''}" style="--c:${pin.color}"><img src="${pin.img}" alt="">${pin.count && pin.count > 1 ? `<span class="pin-n">${pin.count}</span>` : ''}</div>`,
            }),
            zIndexOffset: pin.id === focusId ? 1000 : 0,
          })
        : L.circleMarker([pin.lat, pin.lon], { radius: 7, color: '#fff', weight: 2, fillColor: pin.color, fillOpacity: 1 })
      marker.on('click', () => onPinRef.current?.(pin.id))
      marker.addTo(group)
    }
  }, [pins, lines, focusId])

  // Si riadatta solo quando cambia l'insieme dei punti, non a ogni ridisegno:
  // altrimenti ogni nota o stellina farebbe saltare la vista.
  useEffect(() => {
    const m = map.current
    if (!m || pins.length === 0) return
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lon] as [number, number]))
    m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  useEffect(() => {
    const m = map.current
    const pin = pins.find((p) => p.id === focusId)
    if (!m || !pin) return
    m.flyTo([pin.lat, pin.lon], Math.max(m.getZoom(), 14), { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  return <div ref={el} className={`map${tall ? ' tall' : ''}`} />
}
