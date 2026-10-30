/**
 * NOTIFICHE DEI VIAGGI SEGUITI (caricato dal service worker con importScripts,
 * vedi `workbox.importScripts` in vite.config.ts).
 *
 * Il server inoltra { s: id del viaggio condiviso, d: 1 se è il riepilogo del
 * giorno, m: [messaggi cifrati] }. I messaggi li ha cifrati chi viaggia con la
 * chiave del viaggio: si decifrano qui, con la chiave salvata nell'archivio
 * dell'app (tabella `shares`), e diventano «3 foto nuove · Bangkok, Wat Pho».
 *
 * ⚠️ iOS toglie il permesso alle app che ricevono una notifica senza mostrarla:
 * qualunque cosa succeda, una notifica si mostra sempre.
 */

function idb(store, run) {
  return new Promise((resolve) => {
    const open = indexedDB.open('mytrip')
    open.onerror = () => resolve(undefined)
    open.onsuccess = () => {
      try {
        const req = run(open.result.transaction(store, 'readonly').objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(undefined)
      } catch {
        resolve(undefined)
      }
    }
  })
}

const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** Come `decrypt` in src/crypt.ts: iv (12 byte) + dati, il nome del pezzo come dato aggiuntivo. */
async function open(rawKey, data, name) {
  const key = await crypto.subtle.importKey('raw', unb64u(rawKey), 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, data.slice(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

async function onPush(event) {
  let title = 'MyTrip'
  let body = 'Un viaggio che segui ha novità'
  let tripId
  try {
    const data = event.data.json()
    const shares = (await idb('shares', (s) => s.getAll())) ?? []
    const share = shares.find((x) => x.id === data.s && x.role === 'follow')
    if (share) {
      tripId = share.tripId
      const trip = await idb('trips', (s) => s.get(tripId))
      if (trip?.name) title = trip.name
      let photos = 0
      const places = []
      for (const c of data.m ?? []) {
        try {
          const msg = await open(share.key, unb64u(c), `${data.s}/n`)
          photos += msg.n ?? 0
          for (const p of msg.p ?? []) if (!places.includes(p)) places.push(p)
        } catch {
          // Un messaggio illeggibile non ferma gli altri.
        }
      }
      if (photos > 0) {
        const where = places.length ? ` · ${places.slice(0, 3).join(', ')}${places.length > 3 ? '…' : ''}` : ''
        body = `${photos === 1 ? '1 foto nuova' : `${photos} foto nuove`}${data.d ? ' oggi' : ''}${where}`
      }
    }
  } catch {
    // Contenuto inatteso: resta il testo generico.
  }
  await self.registration.showNotification(title, {
    body,
    tag: tripId ?? 'mytrip',
    data: { tripId },
    icon: `${self.registration.scope}pwa-192x192.png`,
  })
}

self.addEventListener('push', (event) => event.waitUntil(onPush(event)))

/** Tocco sulla notifica: si apre il viaggio. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const tripId = event.notification.data?.tripId
  const url = `${self.registration.scope}${tripId ? `#/viaggio/${encodeURIComponent(tripId)}` : ''}`
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = windows[0]
      if (win) {
        await win.focus()
        await win.navigate(url).catch(() => {})
      } else await self.clients.openWindow(url)
    })(),
  )
})
