/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Image CDN's path on a Netlify build, `/.netlify/images`; '' elsewhere (`vite.config.ts`). */
  readonly VITE_PICTURE_CDN?: string
  /** raven's origin on a build whose `/api` proxies to it, core's `DEFAULT_SERVER_ORIGIN` on Netlify; '' when `/api` is raven itself (`vite.config.ts`). */
  readonly VITE_API_ORIGIN?: string
}
