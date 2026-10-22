import { object, oneOf } from '@/schema'

/**
 * raven player serves the web app's build from this loopback port and proxies `/api` to its
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
  error: oneOf([WEB_HOST_ERRORS.serverUnreachable]),
})

/** What a proxy in front of the server answers when it cannot reach it. */
const GATEWAY_STATUSES = { badGateway: 502, unavailable: 503, timeout: 504 } as const

const isGatewayStatus = oneOf(Object.values(GATEWAY_STATUSES))

/**
 * Whether an answer says the server is out of reach rather than answering: raven player's web
 * host said so, or a proxy in front of it (a Funnel with the NAS down) gave a gateway status
 * with a body that is not JSON, which the server itself never sends. `body` is null when the
 * body did not parse.
 */
export const isUnreachableAnswer = ({ status, body }: { status: number; body: unknown }): boolean =>
  isServerUnreachableBody(body) || (isGatewayStatus(status) && body === null)

/** The environment variables a raven player build reads. */
export const DESKTOP_ENV = {
  /** The server `/api` goes to, an http or https origin with no path. */
  serverOrigin: 'RAVEN_DESKTOP_SERVER_ORIGIN',
  /** Comma separated origins whose `raven://` links name the same server. */
  linkOrigins: 'RAVEN_DESKTOP_LINK_ORIGINS',
} as const

/**
 * The server a build without `RAVEN_DESKTOP_SERVER_ORIGIN` uses: Vhagar's Tailscale Funnel, where
 * Netlify's `RAVEN_API_ORIGIN` sends the web app's `/api`, so raven player signs in to the same
 * accounts and keeps the same library, progress and favourites as the web.
 */
export const DEFAULT_SERVER_ORIGIN = 'https://raven.tail5586d4.ts.net'
