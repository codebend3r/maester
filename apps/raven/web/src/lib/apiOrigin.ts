import { MEDIA_ORIGIN_KINDS, type MediaOrigin } from '@raven/core'
import { useMediaOrigin } from '@raven/ui'

/**
 * raven's origin when this page's `/api` is a proxy to it (Netlify's
 * `netlify.toml`, core's `DEFAULT_SERVER_ORIGIN`); '' when `/api` is raven itself.
 */
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? ''

const IS_API_PROXIED = API_ORIGIN !== ''

type MediaOriginOfProps = { apiOrigin: string }

/**
 * Where a page's video and music come from: raven's public origin when its
 * `/api` is a proxy, so media never travels through the proxy (whose host
 * bills it as bandwidth), and null, the page's own `/api`, when that is raven itself.
 */
export const mediaOriginOf = ({ apiOrigin }: MediaOriginOfProps): MediaOrigin | null =>
  apiOrigin === '' ? null : { kind: MEDIA_ORIGIN_KINDS.public, url: apiOrigin }

/**
 * Names this page's media origin before anything plays, with no request:
 * nothing is probed and nothing falls back to the proxy. A page whose `/api`
 * is raven itself (raven's own, Vite's, Raven's) names none.
 */
export const startMediaOrigin = (): void => {
  const origin = mediaOriginOf({ apiOrigin: API_ORIGIN })
  if (origin === null) return
  useMediaOrigin.getState().setPick({ origin, at: Date.now() })
}

/** The server this page's media comes from: the proxied origin, else this page's own. */
export const serverOrigin = (): string => (IS_API_PROXIED ? API_ORIGIN : window.location.origin)
