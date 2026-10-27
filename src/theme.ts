import { useSyncExternalStore } from 'react'

/**
 * TEMI (Impostazioni › Aspetto)
 *
 * I colori vivono nelle variabili CSS di `index.css`: cambiare tema è cambiare
 * l'attributo data-theme sulla radice. La scelta sta in localStorage (è una
 * preferenza del dispositivo, non va negli export) e si applica in `main.tsx`
 * PRIMA del primo disegno, per non far lampeggiare il tema vecchio.
 *
 * ⚠️ `preview` ripete alcuni colori di `index.css` per l'anteprima e per la
 * barra di stato: se si cambia una palette, va cambiata in tutti e due i posti.
 * Struttura ripresa da MyBsns, palette proprie.
 */
export type ThemeId = 'calce' | 'terracotta' | 'moderno'

export interface Theme {
  id: ThemeId
  name: string
  description: string
  preview: { bg: string; card: string; accent: string; blue: string; saff: string }
}

export const THEMES: Theme[] = [
  {
    id: 'calce',
    name: 'Calce e tè',
    description: 'Il tema di partenza, dal sito di Greta.',
    preview: { bg: '#f5f0e6', card: '#dce6d5', accent: '#2f6b4f', blue: '#1f4e8c', saff: '#e3a02b' },
  },
  {
    id: 'terracotta',
    name: 'Sabbia e terracotta',
    description: 'Caldo e mediterraneo, con il blu del mare.',
    preview: { bg: '#f6ede1', card: '#ecdac5', accent: '#b0532c', blue: '#2a6987', saff: '#d9962b' },
  },
  {
    id: 'moderno',
    name: 'Nebbia e indaco',
    description: 'Moderno: grigi freddi, indaco, titoli senza grazie.',
    preview: { bg: '#f3f4f7', card: '#e4e7ef', accent: '#4338ca', blue: '#0e7490', saff: '#f59e0b' },
  },
]

const KEY = 'mytrip:theme'
export const DEFAULT_THEME: ThemeId = 'calce'

const known = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v)

function load(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY)
    if (known(saved)) return saved
  } catch {
    // Spazio non disponibile: tema predefinito.
  }
  return DEFAULT_THEME
}

let current = load()
const listeners = new Set<() => void>()

export function applyTheme(id: ThemeId = current): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]
  if (theme.id === DEFAULT_THEME) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme.id
  // Anche la barra di stato segue il tema.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.preview.bg)
}

export function setTheme(id: ThemeId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Non salvato: il tema vale per questa apertura.
  }
  current = id
  applyTheme(id)
  for (const l of listeners) l()
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** Un colore del tema attivo, letto dalle variabili CSS (per i disegni su canvas della mappa). */
export function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
