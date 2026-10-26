import { db, stopTitle } from './db'
import { fmtDateTime } from './format'
import { transportOf } from './transport'
import { describeWeather } from './weather'

/**
 * Export dell'itinerario in KML: si importa in Google My Maps (Crea mappa →
 * Importa) e si apre in Google Earth. Contiene tappe, date, note e percorso;
 * le foto no, perché KML non le incorpora.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** KML vuole il colore come aabbggrr. */
function kmlColor(hex: string): string {
  const h = hex.replace('#', '')
  return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`
}

export async function exportKml(tripId: string): Promise<File> {
  const trip = await db.trips.get(tripId)
  if (!trip) throw new Error('Viaggio non trovato')
  const stops = await db.stops.where('tripId').equals(tripId).sortBy('start')

  const placemarks = stops
    .map((s, i) => {
      const lines = [fmtDateTime(s.first)]
      const t = transportOf(s.transport)
      if (i > 0 && t) lines.push(`Arrivo: ${t.label}`)
      if (s.weather) lines.push(`${describeWeather(s.weather.code).label}, ${s.weather.temp}°`)
      if (s.note) lines.push(s.note)
      return `    <Placemark>
      <name>${esc(`${i + 1}. ${stopTitle(s)}`)}</name>
      <description>${esc(lines.join('\n'))}</description>
      <styleUrl>#${s.star ? 'speciale' : 'tappa'}</styleUrl>
      <Point><coordinates>${s.lon},${s.lat},0</coordinates></Point>
    </Placemark>`
    })
    .join('\n')

  const route = stops.map((s) => `${s.lon},${s.lat},0`).join(' ')
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(trip.name)}</name>
    <Style id="tappa"><IconStyle><color>${kmlColor(trip.color)}</color></IconStyle></Style>
    <Style id="speciale"><IconStyle><color>ff00ccff</color><scale>1.3</scale></IconStyle></Style>
    <Style id="percorso"><LineStyle><color>${kmlColor(trip.color)}</color><width>3</width></LineStyle></Style>
${placemarks}
    <Placemark>
      <name>Itinerario</name>
      <styleUrl>#percorso</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${route}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>
`
  const safe = trip.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'viaggio'
  return new File([kml], `${safe}.kml`, { type: 'application/vnd.google-earth.kml+xml' })
}
