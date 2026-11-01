import {
  type Infer,
  isBoolean,
  isString,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
} from '@/schema'

/** The services an account's listens are forwarded to, by the server, once the account links them. */
export const SCROBBLE_SERVICES = { listenBrainz: 'listenBrainz', lastFm: 'lastFm' } as const

export const isScrobbleService = oneOf(Object.values(SCROBBLE_SERVICES))

export type ScrobbleService = Infer<typeof isScrobbleService>

/**
 * `GET /api/me/scrobbling`, one per service: whether this server can link
 * it (Last.fm needs the server's keys), and the account's name there once
 * linked, else null.
 */
export const isScrobbleStatus = object({
  service: isScrobbleService,
  isAvailable: isBoolean,
  username: nullable(isString),
})

export type ScrobbleStatus = Infer<typeof isScrobbleStatus>

export const isScrobbleStatusList = listOf(isScrobbleStatus)

/** A ListenBrainz user token, as its settings page shows it: no spaces, up to 128 characters. */
const isListenBrainzToken = matching(/^[\w-]{1,128}$/u)

/** `PUT /api/me/scrobbling/listenbrainz`: the token ListenBrainz checks before it is kept. */
export const isListenBrainzLink = object({ token: isListenBrainzToken })

export type ListenBrainzLink = Infer<typeof isListenBrainzLink>

/**
 * Where Last.fm's sign-in comes back to, exactly: the web's Settings, a
 * path on the web app's own origin, or Wren's scrobbling screen.
 */
export const SCROBBLE_RETURNS = { web: '/settings', wren: 'wren://scrobbling' } as const

/** `POST /api/me/scrobbling/lastfm/start`: where to come back to once Last.fm signed the account in. */
export const isLastFmStart = object({ returnTo: isString })

export type LastFmStart = Infer<typeof isLastFmStart>

/** What `start` answers: Last.fm's sign-in page to open. */
export const isLastFmAuthPage = object({ url: isString })

export type LastFmAuthPage = Infer<typeof isLastFmAuthPage>

/** Where scrobbling is asked for and changed; `:service` is one of `SCROBBLE_SERVICES`. */
export const SCROBBLING_PATHS = {
  root: '/api/me/scrobbling',
  listenBrainz: '/api/me/scrobbling/listenbrainz',
  lastFmStart: '/api/me/scrobbling/lastfm/start',
  lastFmCallback: '/api/me/scrobbling/lastfm/callback',
  service: '/api/me/scrobbling/:service',
} as const

/** What Last.fm's sign-in hands the callback, and the parameter the return address learns the outcome by. */
export const SCROBBLE_PARAMS = { token: 'token', state: 'state', outcome: 'scrobbling' } as const

/** How Last.fm's sign-in ended, in the return address's `?scrobbling=`. */
export const SCROBBLE_OUTCOMES = { linked: 'linked', failed: 'failed' } as const
