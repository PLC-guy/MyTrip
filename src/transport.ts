/**
 * Mezzo usato per arrivare a una tappa dalla precedente. Lo sceglie chi usa
 * l'app; se manca si deduce dalla distanza (vedi legs.ts). Gli spostamenti
 * dentro una tappa non si registrano.
 *
 * ⚠️ Le `key` sono salvate dentro le tappe e nei file esportati: non si
 * rinominano. Per cambiare ciò che si legge basta `label`.
 */
export const TRANSPORTS = [
  { key: 'walk', label: 'A piedi', icon: '🚶' },
  { key: 'bike', label: 'Bici', icon: '🚲' },
  { key: 'scooter', label: 'Scooter', icon: '🛵' },
  { key: 'car', label: 'Auto', icon: '🚗' },
  // Il taxi è sempre un'auto (richiesta dell'utente, 1/11/2026): non si sceglie
  // più, ma le tappe vecchie col taxi si leggono come «Auto».
  { key: 'taxi', label: 'Auto', icon: '🚗', hidden: true },
  { key: 'bus', label: 'Bus', icon: '🚌' },
  { key: 'train', label: 'Treno', icon: '🚆' },
  { key: 'boat', label: 'Traghetto', icon: '⛴️' },
  // Barca piccola (gite, lance, longtail): niente rotta mappata, linea dritta.
  { key: 'smallboat', label: 'Barca', icon: '🚤' },
  { key: 'plane', label: 'Aereo', icon: '✈️' },
] as const

export type TransportKey = (typeof TRANSPORTS)[number]['key']

export const transportOf = (key?: string) => TRANSPORTS.find((t) => t.key === key)

/** I mezzi che si possono scegliere (senza quelli tenuti solo per le tappe vecchie). */
export const CHOOSABLE = TRANSPORTS.filter((t) => !('hidden' in t && t.hidden))
/** Il mezzo da mostrare acceso nella scelta: il taxi vecchio accende «Auto». */
export const chosenKey = (key?: string) => (key === 'taxi' ? 'car' : key)
