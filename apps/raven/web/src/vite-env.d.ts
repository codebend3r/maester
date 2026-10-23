/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build CI bakes into raven's image, `X.Y.Z.N` (see `@/lib/version`). */
  readonly VITE_RAVEN_VERSION?: string
}

interface Window {
  /** Raven's preload bridge, on the desktop app's own origin only; checked before use. */
  readonly ravenDesktop?: unknown
}
