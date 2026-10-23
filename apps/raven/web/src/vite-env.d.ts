/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build CI bakes into raven's image, `X.Y.Z.N` (see `@/lib/version`). */
  readonly VITE_RAVEN_VERSION?: string
  /** The Image CDN's path on a Netlify build, `/.netlify/images`; '' elsewhere (`vite.config.ts`). */
  readonly VITE_PICTURE_CDN?: string
}

interface Window {
  /** Raven's preload bridge, on the desktop app's own origin only; checked before use. */
  readonly ravenDesktop?: unknown
}
