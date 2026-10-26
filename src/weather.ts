import { db, type Stop } from './db'

/**
 * Meteo di ogni tappa all'ora della prima foto, dal servizio gratuito
 * Open-Meteo (senza chiave). Si chiede in sottofondo, una tappa alla volta.
 *
 * L'archivio storico arriva fino a circa una settimana fa; per i giorni più
 * recenti si usa il servizio delle previsioni, che conserva anche i giorni passati.
 * Con `timezone=auto` le ore restituite sono quelle locali del posto, le stesse
 * della stringa EXIF della foto.
 */
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const RECENT = 'https://api.open-meteo.com/v1/forecast'
const RECENT_DAYS = 7
const PAUSE_MS = 400

let running = false
let again = false

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function urlFor(stop: Stop): string {
  const day = stop.first.slice(0, 10)
  const ageDays = (Date.now() - Date.parse(day + 'T00:00:00Z')) / 86_400_000
  const base = ageDays > RECENT_DAYS ? ARCHIVE : RECENT
  return `${base}?latitude=${stop.lat.toFixed(4)}&longitude=${stop.lon.toFixed(4)}&start_date=${day}&end_date=${day}&hourly=temperature_2m,weather_code&timezone=auto`
}

export async function weatherPending(): Promise<void> {
  if (!navigator.onLine) return
  if (running) {
    again = true
    return
  }
  running = true
  let complete = true
  try {
    // Il futuro non ha un meteo «storico»: una foto con data sbagliata si salta.
    const today = new Date().toISOString().slice(0, 10)
    const pending = (await db.stops.toArray()).filter((s) => !s.weatherDone && s.first.slice(0, 10) <= today)
    for (const stop of pending) {
      let reply: { hourly?: { time: string[]; temperature_2m: (number | null)[]; weather_code: (number | null)[] } }
      try {
        const res = await fetch(urlFor(stop))
        if (!res.ok) throw new Error(String(res.status))
        reply = await res.json()
      } catch {
        complete = false
        break
      }
      // L'ora della foto, arrotondata all'ora intera: "2026-09-26T18:18" → "2026-09-26T18:00".
      const hour = stop.first.slice(0, 13) + ':00'
      const i = reply.hourly?.time.indexOf(hour) ?? -1
      const temp = i >= 0 ? reply.hourly!.temperature_2m[i] : null
      const code = i >= 0 ? reply.hourly!.weather_code[i] : null
      await db.stops.update(stop.id, {
        weatherDone: true,
        weather: temp != null && code != null ? { temp: Math.round(temp), code } : undefined,
      })
      await pause(PAUSE_MS)
    }
  } finally {
    running = false
  }
  if (again && complete) {
    again = false
    await weatherPending()
  }
}

window.addEventListener('online', () => void weatherPending())

/** Codici WMO → icona e descrizione. */
export function describeWeather(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Sereno' }
  if (code <= 2) return { icon: '🌤️', label: 'Poco nuvoloso' }
  if (code === 3) return { icon: '☁️', label: 'Coperto' }
  if (code <= 48) return { icon: '🌫️', label: 'Nebbia' }
  if (code <= 57) return { icon: '🌦️', label: 'Pioviggine' }
  if (code <= 67) return { icon: '🌧️', label: 'Pioggia' }
  if (code <= 77) return { icon: '🌨️', label: 'Neve' }
  if (code <= 82) return { icon: '🌧️', label: 'Rovesci' }
  if (code <= 86) return { icon: '🌨️', label: 'Rovesci di neve' }
  return { icon: '⛈️', label: 'Temporale' }
}
