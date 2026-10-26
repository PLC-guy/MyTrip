/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_TIME__: string
declare const __COMMIT__: string
declare const __VERSION__: string

declare module 'exifr/dist/lite.esm.mjs' {
  import exifr from 'exifr'
  export default exifr
}
