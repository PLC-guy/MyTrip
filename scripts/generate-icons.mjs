// Genera i PNG richiesti da iOS e dal manifest a partire da public/icon.svg.
// Si rilancia solo quando cambia l'icona:  npm run icons
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const svg = await readFile(join(publicDir, 'icon.svg'))

const targets = [
  { file: 'pwa-192x192.png', size: 192 },
  { file: 'pwa-512x512.png', size: 512 },
  { file: 'maskable-512x512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

for (const { file, size } of targets) {
  // iOS arrotonda da solo gli angoli: lo sfondo deve arrivare fino al bordo,
  // altrimenti compaiono angoli bianchi.
  const png = await sharp(svg).resize(size, size).flatten({ background: '#2F6B4F' }).png().toBuffer()
  await writeFile(join(publicDir, file), png)
  console.log(`${file} (${size}x${size})`)
}
