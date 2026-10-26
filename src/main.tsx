import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Caratteri del sito di Greta, inclusi nell'app: funzionano anche offline.
import '@fontsource/young-serif/latin-400.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
