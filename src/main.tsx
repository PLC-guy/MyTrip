import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Caratteri del sito di Greta, inclusi nell'app: funzionano anche offline.
import '@fontsource/young-serif/latin-400.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import './index.css'
import App from './App.tsx'
import { applyTheme } from './theme'
import { countMe } from './ping'

// Prima del primo disegno: niente lampo del tema predefinito.
applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Conteggio anonimo delle app in uso (ping.ts).
countMe()
