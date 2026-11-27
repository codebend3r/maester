import {
  AUTH_PATHS,
  FILE_SCHEME,
  PAGE_ORIGIN,
  PICTURE_SCHEME,
  WEB_HOST,
  WEB_HOST_ERRORS,
  WEB_HOST_PORT,
} from '@raven/core'
import {
  type Handler,
  type PolicySources,
  type Timers,
  createWebHostHandler,
  isPortTaken,
} from '@shared/desktop'
import { errorText } from '@/main/log/errorText'
import { quietly } from '@/main/log/quietly'

/** The log line the packaged smoke waits for: the page has somewhere to load from. */
export const WEB_HOST_READY = 'web host ready'

/**
 * What `/api` asks of the home server whichever server is in use: the account config the page's
 * sign-in and the account's server list are read from.
 */
const HOME_PATHS: ReadonlySet<string> = new Set([AUTH_PATHS.config])

type PolicySourcesForProps = { authOrigin: string | null }

/**
 * What Raven's page loads beyond its own files: saved pictures and downloads by their schemes,
 * and the test hook's Supabase Auth, `authOrigin`, when one is set.
 */
export const policySourcesFor = ({ authOrigin }: PolicySourcesForProps): PolicySources => ({
  images: [`${PICTURE_SCHEME}:`],
  media: [`${FILE_SCHEME}:`],
  connections: authOrigin === null ? [] : [authOrigin],
})

type CreateRavenHostHandlerProps = {
  root: string
  /** The server in use, read for each request, so `/api` follows the page's switch. */
  serverOrigin: () => string
  /** The server the build plays from, which answers `HOME_PATHS` whichever is in use. */
  homeOrigin: string
  /** The test hook's Supabase Auth origin, which the policy lets the page call; null for none. */
  authOrigin: string | null
  readFile: (path: string) => Promise<Uint8Array>
  timers: Timers
  warn: (message: string) => void
  info: (message: string) => void
}

/**
 * Raven's web host: `@raven/web`'s build on `localhost:47484`, and `/api` passed on to the server
 * in use, but for `HOME_PATHS`, which go to the home server.
 */
export const createRavenHostHandler = ({
  serverOrigin,
  homeOrigin,
  authOrigin,
  warn,
  info,
  ...rest
}: CreateRavenHostHandlerProps): Handler =>
  createWebHostHandler({
    ...rest,
    host: WEB_HOST,
    pageOrigin: PAGE_ORIGIN,
    upstreamOf: (url) => (HOME_PATHS.has(url.pathname) ? homeOrigin : serverOrigin()),
    sources: policySourcesFor({ authOrigin }),
    unreachableBody: JSON.stringify({ error: WEB_HOST_ERRORS.serverUnreachable }),
    notes: {
      unreachable: (reason) => `Raven could not reach its server: ${reason}`,
      reachedAgain: 'Raven reached its server again',
    },
    warn: quietly(warn),
    info: quietly(info),
  })

/** What the person is told when the web host cannot listen, and Raven quits. */
export const webHostFailureText = (error: unknown): string =>
  isPortTaken(error)
    ? `Another app is using port ${WEB_HOST_PORT} on this computer. Quit it, then open Raven again.`
    : `Raven could not start serving its page: ${errorText(error)}`
