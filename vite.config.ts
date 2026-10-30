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
  build: {
    // La libreria della mappa (MapLibre, ~1 MB) in un file a parte: cambia di
    // rado, quindi a ogni aggiornamento dell'app il telefono riscarica solo il
    // codice dell'app e non anche la mappa.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined),
      },
    },
  },
  // ⚠️ Il codificatore JPEG (@jsquash/jpeg) carica il suo .wasm da sé: Vite non deve
  // pre-elaborarlo in sviluppo, altrimenti non lo trova (indicazione del pacchetto).
  optimizeDeps: { exclude: ['@jsquash/jpeg'] },
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
        background_color: '#F5F0E6',
        theme_color: '#F5F0E6',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // wasm: il codificatore JPEG degli export da condividere (~250 KB), anche offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        cleanupOutdatedCaches: true,
        navigateFallback: `${BASE}index.html`,
        runtimeCaching: [
          {
            // Confini dei paesi (500 KB): non nella precache, che li farebbe
            // scaricare a ogni installazione; si tengono dopo la prima apertura
            // della schermata Paesi.
            urlPattern: ({ url }) => url.pathname.endsWith('/countries.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'paesi' },
          },
          {
            // Stile e indice delle tile di OpenFreeMap: prima la rete. L'indice
            // punta a una versione datata delle tile che cambia a ogni
            // aggiornamento della mappa; tenerlo per sempre in cache finirebbe
            // per chiedere tile che il server non ha più.
            urlPattern: ({ url }) => url.host === 'tiles.openfreemap.org' && (url.pathname.startsWith('/styles/') || url.pathname === '/planet'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mappa-stile',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Tile, caratteri e simboli già visti restano disponibili offline,
            // con un tetto: niente scaricamento di zone in blocco.
            urlPattern: ({ url }) => url.host === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'mappe',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
})
