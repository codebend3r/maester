/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build CI bakes into raven's image, `X.Y.Z.N` (see `@/lib/version`). */
  readonly VITE_RAVEN_VERSION?: string
}
