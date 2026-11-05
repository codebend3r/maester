/**
 * raven's origin when this page's `/api` is a proxy to it (Netlify's
 * `netlify.toml`, core's `DEFAULT_SERVER_ORIGIN`); '' when `/api` is raven itself.
 */
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? ''

/** Whether `/api` is a proxy. Media that falls back to it then travels through the proxy, which its host bills as bandwidth. */
export const IS_API_PROXIED = API_ORIGIN !== ''

/** The server this page's media comes from: the proxied origin, else this page's own. */
export const serverOrigin = (): string => (IS_API_PROXIED ? API_ORIGIN : window.location.origin)
