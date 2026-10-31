import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { isNumber, isRecord, isString } from '@raven/core'
import { CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@shared/server'
import { SERVER_CONFIG, type LastFmKeys, type ServerConfig } from '@/config'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { RAVEN_USER_AGENT } from '@/music/userAgent'
import {
  type LinkedAccount,
  type Listen,
  type Scrobbler,
  type SendOutcome,
  SEND_OUTCOMES,
  outcomeOfStatus,
} from '@/scrobbling/scrobbler'

/** Last.fm's API, which takes every call as a form POST here, so no token or key rides in a URL. */
export const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/'

/** The page an account allows raven on, which comes back to `cb` with `?token=`. */
export const LASTFM_AUTH_PAGE = 'https://www.last.fm/api/auth/'

/** The methods raven calls. */
export const LASTFM_METHODS = {
  getSession: 'auth.getSession',
  scrobble: 'track.scrobble',
} as const

/** The parameters every call carries: raven's key and the call's signature. */
export const LASTFM_PARAMS = { apiKey: 'api_key', apiSig: 'api_sig' } as const

/** Parameters that are sent but never signed, as Last.fm's signing leaves them out. */
const UNSIGNED = { format: 'format', callback: 'callback' } as const

/** How long one call may take before Last.fm counts as away. */
const TIMEOUT_MS = 10_000

/**
 * Last.fm's error codes raven tells apart: a sign-in token it does not
 * know, has not allowed or has let expire; a session key gone; and the
 * service offline, failing for now or asking raven to slow down.
 */
export const LASTFM_ERRORS = {
  invalidToken: 4,
  invalidSession: 9,
  offline: 11,
  unauthorizedToken: 14,
  expiredToken: 15,
  temporary: 16,
  rateLimited: 29,
} as const

const REFUSED_TOKENS: ReadonlySet<number> = new Set([
  LASTFM_ERRORS.invalidToken,
  LASTFM_ERRORS.unauthorizedToken,
  LASTFM_ERRORS.expiredToken,
])

const PASSING: ReadonlySet<number> = new Set([
  LASTFM_ERRORS.offline,
  LASTFM_ERRORS.temporary,
  LASTFM_ERRORS.rateLimited,
])

type SignedProps = { params: Record<string, string>; keys: LastFmKeys }

/**
 * `api_sig`: the md5, in hex, of every parameter but `format` and
 * `callback`, sorted by name in code-unit order and written name then
 * value, followed by the shared secret.
 */
export const signed = ({ params, keys }: SignedProps): Record<string, string> => {
  const unsigned: readonly string[] = Object.values(UNSIGNED)
  const text = Object.entries(params)
    .filter(([name]) => !unsigned.includes(name))
    .toSorted(([a], [b]) => Number(a > b) - Number(a < b))
    .map(([name, value]) => `${name}${value}`)
    .join('')
  return {
    ...params,
    [LASTFM_PARAMS.apiSig]: createHash('md5')
      .update(`${text}${keys.apiSecret}`, 'utf8')
      .digest('hex'),
  }
}

/** Last.fm's error code in a body, or null for one that carries none. */
const errorOf = (body: unknown): number | null =>
  isRecord(body) && isNumber(body.error) ? body.error : null

type LastFmScrobblerAuthPageProps = { callback: string }

type LastFmScrobblerValidateProps = { token: string }

type LastFmScrobblerSendProps = { secret: string; listen: Listen }

type LastFmScrobblerCallProps = { keys: LastFmKeys; params: Record<string, string> }

/**
 * Last.fm, on raven's own API account: on only while `LASTFM_API_KEY` and
 * `LASTFM_API_SECRET` are both set. An account allows raven on Last.fm's
 * page, which hands the callback a one-use token; `validate` trades it with
 * `auth.getSession` for the session key raven keeps, and each listen goes
 * out with `track.scrobble`, every call signed per Last.fm's API.
 */
@Injectable()
export class LastFmScrobbler implements Scrobbler {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
  ) {}

  isAvailable(): boolean {
    return this.config.lastFm !== null
  }

  private keys(): LastFmKeys {
    const keys = this.config.lastFm
    if (keys === null) throw new Error('Last.fm is off: LASTFM_API_KEY and LASTFM_API_SECRET.')
    return keys
  }

  /** Last.fm's page that asks the account to allow raven, then goes to `callback`. */
  authPage({ callback }: LastFmScrobblerAuthPageProps): string {
    const query = new URLSearchParams({ [LASTFM_PARAMS.apiKey]: this.keys().apiKey, cb: callback })
    return `${LASTFM_AUTH_PAGE}?${query.toString()}`
  }

  private call({ keys, params }: LastFmScrobblerCallProps): Promise<Response> {
    const body = new URLSearchParams({
      ...signed({ params: { ...params, [LASTFM_PARAMS.apiKey]: keys.apiKey }, keys }),
      [UNSIGNED.format]: 'json',
    })
    return this.fetch({
      url: LASTFM_API,
      init: {
        method: HTTP_METHODS.post,
        headers: {
          [HEADERS.accept]: CONTENT_TYPES.json,
          [HEADERS.contentType]: CONTENT_TYPES.form,
          [HEADERS.userAgent]: RAVEN_USER_AGENT,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    })
  }

  async validate({ token }: LastFmScrobblerValidateProps): Promise<LinkedAccount | null> {
    const response = await this.call({
      keys: this.keys(),
      params: { method: LASTFM_METHODS.getSession, token },
    })
    const body: unknown = await response.json().catch(() => null)
    const error = errorOf(body)
    if (error !== null && REFUSED_TOKENS.has(error)) return null
    const session = isRecord(body) ? body.session : null
    if (!response.ok || !isRecord(session)) {
      throw new Error(`Last.fm answered ${response.status} with error ${error ?? 'none'}.`)
    }
    return isString(session.name) && isString(session.key)
      ? { username: session.name, secret: session.key }
      : null
  }

  async send({ secret, listen }: LastFmScrobblerSendProps): Promise<SendOutcome> {
    const keys = this.config.lastFm
    if (keys === null) return SEND_OUTCOMES.retry
    const params = {
      method: LASTFM_METHODS.scrobble,
      sk: secret,
      artist: listen.artist,
      track: listen.track,
      album: listen.album,
      timestamp: String(listen.listenedAt),
      ...(listen.durationSeconds === null
        ? {}
        : { duration: String(Math.round(listen.durationSeconds)) }),
      ...(listen.recordingMbid === null ? {} : { mbid: listen.recordingMbid }),
    }
    const response = await this.call({ keys, params }).catch(() => null)
    if (response === null) return SEND_OUTCOMES.retry
    const error = errorOf(await response.json().catch(() => null))
    if (error === LASTFM_ERRORS.invalidSession) return SEND_OUTCOMES.unlinked
    if (error !== null && PASSING.has(error)) return SEND_OUTCOMES.retry
    if (error !== null) return SEND_OUTCOMES.rejected
    return outcomeOfStatus(response.status)
  }
}
