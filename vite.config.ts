import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as {
  version: string
}

/** Revisione della build: in Impostazioni dice con certezza cosa gira sul telefono. */
function commitRef(): string {
  const fromCI = process.env.GITHUB_SHA
  if (fromCI) return fromCI.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'locale'
  }
}

/**
 * Il sito vive in una sottocartella: https://plc-guy.github.io/MyTrip/.
 * ⚠️ NON si cambia mai: deve coincidere con `scope` e `start_url`, e l'icona già
 * installata sulla Home punta qui. Cambiarlo romperebbe l'app installata, e
 * reinstallarla cancellerebbe i viaggi.
 */
const BASE = '/MyTrip/'

export default defineConfig({
  base: BASE,
  // React, Leaflet, Dexie ed exifr insieme superano di poco i 500 KB: per una
  // PWA che resta in cache sul telefono non vale la pena spezzarli.
  build: { chunkSizeWarningLimit: 700 },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT__: JSON.stringify(commitRef()),
    __VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' e non 'autoUpdate': il passaggio alla versione nuova lo decide
      // `src/update.ts` (in automatico, ma solo nei momenti sicuri).
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'MyTrip',
        short_name: 'MyTrip',
        description: 'I tuoi viaggi ricostruiti dalle foto',
        lang: 'it',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4EFE6',
        theme_color: '#F4EFE6',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: `${BASE}index.html`,
        runtimeCaching: [
          {
            // Le mappe già viste restano disponibili offline. Le richieste sono
            // CORS (crossOrigin sul tileLayer): una risposta opaca peserebbe
            // diversi MB di quota ciascuna.
            // ⚠️ Le regole di OpenStreetMap vietano di scaricare zone in blocco:
            // qui si tengono solo le mappe già viste, con un tetto.
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mappe',
              expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
})
