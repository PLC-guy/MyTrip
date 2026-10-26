# MyTrip

App personale (PWA) per ricostruire i viaggi dalle foto: data, ora e posizione
vengono letti dai metadati dello scatto e diventano tappe su una mappa.

- Si crea un viaggio e si aggiungono le foto dalla galleria del telefono.
- Entrano solo le foto con data e posizione GPS nei metadati.
- Le foto vicine nello spazio e nel tempo diventano una tappa, con il nome del
  luogo ricavato da OpenStreetMap.
- Ogni tappa ha nota, stellina per i posti speciali, condivisione e apertura in Mappe.
- Ogni viaggio si esporta in un file e si reimporta su un altro dispositivo.

Le foto originali non lasciano mai il telefono: l'app conserva solo una miniatura
e i metadati, nel browser (IndexedDB).

Tecnologia: Vite, React, TypeScript, Dexie, Leaflet, exifr, vite-plugin-pwa.
Pubblicata su GitHub Pages; si aggiorna da sola all'apertura.
