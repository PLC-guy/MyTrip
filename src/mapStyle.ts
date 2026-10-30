import maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'

/**
 * STILE DELLA MAPPA, PREPARATO UNA VOLTA SOLA
 *
 * ⚠️ Perché le mappe ci mettevano a comparire a ogni cambio di viaggio o di
 * schermata (osservazione dell'utente, 30/10/2026): ogni mappa nuova scaricava
 * lo stile e poi, in fila, l'indice delle tile (`/planet`). Tutti e due sono in
 * cache «prima la rete» (l'indice punta a tile datate che cambiano), quindi
 * erano due attese di rete prima ancora di chiedere le tile, che invece
 * arrivano subito dalla cache.
 *
 * Ora stile e indice si chiedono una volta per sessione: l'indice si scrive
 * dentro lo stile (`tiles` al posto di `url`) e le mappe successive partono
 * senza rete. Dopo REFRESH_MS si richiedono, per seguire le tile nuove. Se la
 * rete manca del tutto si ripiega sull'indirizzo dello stile, come prima.
 */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const REFRESH_MS = 6 * 60 * 60 * 1000

let cached: { at: number; style: Promise<StyleSpecification | string> } | undefined
/** Lo stile già pronto, per crearlo subito, senza attese, nelle mappe successive. */
let ready: StyleSpecification | undefined

async function build(): Promise<StyleSpecification | string> {
  try {
    const style = (await (await fetch(STYLE_URL)).json()) as StyleSpecification
    for (const source of Object.values(style.sources)) {
      if ((source.type === 'vector' || source.type === 'raster') && 'url' in source && source.url) {
        const tj = (await (await fetch(source.url)).json()) as { tiles: string[]; minzoom?: number; maxzoom?: number; bounds?: [number, number, number, number]; attribution?: string }
        Object.assign(source, { tiles: tj.tiles, minzoom: tj.minzoom, maxzoom: tj.maxzoom, bounds: tj.bounds, attribution: tj.attribution })
        delete (source as { url?: string }).url
      }
    }
    ready = style
    return style
  } catch {
    cached = undefined
    return STYLE_URL
  }
}

function refresh(): void {
  if (!cached || Date.now() - cached.at > REFRESH_MS) cached = { at: Date.now(), style: build() }
}

/**
 * Lo stile per una mappa nuova, subito: la copia di quello già pronto (MapLibre
 * lo può modificare), oppure l'indirizzo se non è ancora arrivato.
 */
export function mapStyle(): StyleSpecification | string {
  refresh()
  return ready ? structuredClone(ready) : STYLE_URL
}

// Si comincia subito, all'apertura dell'app: le mappe trovano già tutto pronto.
// Anche i «lavoratori» di MapLibre si avviano in anticipo.
refresh()
maplibregl.prewarm()
