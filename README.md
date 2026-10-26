# MyTrip

App personale (PWA) per ricostruire i viaggi dalle foto: data, ora e posizione
vengono letti dai metadati dello scatto e diventano tappe su una mappa.

- Si crea un viaggio (di piacere o di lavoro) e si aggiungono le foto dalla
  galleria del telefono. Entrano solo le foto con data e posizione GPS.
- Le foto vicine nello spazio e nel tempo diventano una tappa, con nome del luogo
  e meteo dell'ora dello scatto. Le tappe si rinominano, si uniscono e si dividono.
- Mappa in italiano con l'itinerario, il mezzo usato fra una tappa e l'altra e
  un itinerario animato da ripercorrere.
- Statistiche del viaggio, diario per giorno, note e stellina per i posti speciali.
- Ricerca, elenco dei posti speciali di tutti i viaggi, mappa dei paesi visitati.
- Ogni viaggio si esporta in un file e si reimporta su un altro dispositivo, oppure
  in KML per Google My Maps e Google Earth.

Le foto originali non lasciano mai il telefono: l'app conserva solo una miniatura
e i metadati, nel browser (IndexedDB).

Tecnologia: Vite, React, TypeScript, Dexie, MapLibre, exifr, vite-plugin-pwa.
Dati e servizi: OpenFreeMap e OpenStreetMap (mappa e nomi dei luoghi),
Open-Meteo (meteo), Natural Earth (confini dei paesi).
Pubblicata su GitHub Pages; si aggiorna da sola all'apertura.
