import { object, oneOf, literal } from '@/schema'

/**
 * Raven serves the web app's build from this loopback port and proxies `/api` to its
 * server. The port is fixed so the page's origin, and with it its cookies and storage, is the
 * same on every launch.
 */
export const WEB_HOST_PORT = 47484

/** The one `Host` the web host answers; any other is refused, which blocks DNS rebinding. */
export const WEB_HOST = `localhost:${WEB_HOST_PORT}` as const

/** The page's origin: `localhost` rather than `127.0.0.1`, so it is a secure context. */
export const PAGE_ORIGIN = `http://${WEB_HOST}` as const

/** The `error` of the web host's HTTP 502 answer to `/api` when the server cannot be reached. */
export const WEB_HOST_ERRORS = { serverUnreachable: 'server_unreachable' } as const

/** The body of the web host's 502 when it could not reach the server. */
const isServerUnreachableBody = object({
  error: literal(WEB_HOST_ERRORS.serverUnreachable),
})

/** What a proxy in front of the server answers when it cannot reach it. */
const GATEWAY_STATUSES = { badGateway: 502, unavailable: 503, timeout: 504 } as const

const isGatewayStatus = oneOf(Object.values(GATEWAY_STATUSES))

type IsUnreachableAnswerProps = { status: number; body: unknown }

/**
 * Whether an answer says the server is out of reach rather than answering: Raven's web
 * host said so, or a proxy in front of it (Netlify's, or the NAS's reverse proxy with raven down)
 * gave a gateway status
 * with a body that is not JSON, which the server itself never sends. `body` is null when the
 * body did not parse.
 */
export const isUnreachableAnswer = ({ status, body }: IsUnreachableAnswerProps): boolean =>
  isServerUnreachableBody(body) || (isGatewayStatus(status) && body === null)

/** Raven's own pages, which a browser does not have. */
export const DESKTOP_PATHS = {
  downloads: '/downloads',
  local: '/local',
  play: '/play/:fileId',
} as const

/**
 * The server a build without `RAVEN_DESKTOP_SERVER_ORIGIN` uses: raven's public origin, the NAS's
 * reverse proxy in front of raven, so Raven signs in to the same accounts and keeps the same
 * library, progress and favourites as the web wherever the Mac is, at home or away.
 */
export const DEFAULT_SERVER_ORIGIN = 'https://raven-player.synology.me:8443'

/**
 * The web app's Netlify site, which proxies `/api` to the same server. Its watch pages build
 * `raven://` links naming it (`window.location.origin`), so it names the default server too.
 */
const WEB_APP_ORIGIN = 'https://raven-player.netlify.app'

/** The origins whose `raven://` links name the default server besides its own, built in. */
export const DEFAULT_LINK_ORIGINS = [WEB_APP_ORIGIN] as const
