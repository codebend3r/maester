/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build CI bakes into raven's image, `X.Y.Z.N` (see `@/lib/version`). */
  readonly VITE_RAVEN_VERSION?: string
  /** The Image CDN's path on a Netlify build, `/.netlify/images`; '' elsewhere (`vite.config.ts`). */
  readonly VITE_PICTURE_CDN?: string
  /** raven's origin on a build whose `/api` proxies to it, core's `DEFAULT_SERVER_ORIGIN` on Netlify; '' when `/api` is raven itself (`vite.config.ts`). */
  readonly VITE_API_ORIGIN?: string
  /** How many Continue watching tiles the home page shows, from `RAVEN_HOME_CONTINUE_COUNT` (`vite.config.ts`). */
  readonly VITE_HOME_CONTINUE_COUNT?: string
}

interface Window {
  /** Raven's preload bridge, on the desktop app's own origin only; checked before use. */
  readonly ravenDesktop?: unknown
}
