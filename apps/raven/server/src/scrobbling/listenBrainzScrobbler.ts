import { Inject, Injectable } from '@nestjs/common'
import { AUTH_HEADERS, isBoolean, isRecord, isString } from '@raven/core'
import { CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@shared/server'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { LISTENBRAINZ_API, LISTENBRAINZ_TIMEOUT_MS } from '@/music/listenBrainzClient'
import { RAVEN_USER_AGENT } from '@/music/userAgent'
import {
  type LinkedAccount,
  type Listen,
  type Scrobbler,
  type SendOutcome,
  SEND_OUTCOMES,
  outcomeOfStatus,
} from '@/scrobbling/scrobbler'

/** ListenBrainz's routes for checking a token and submitting listens. */
export const LISTENBRAINZ_ROUTES = {
  validate: '/1/validate-token',
  submit: '/1/submit-listens',
} as const

/** What one submission is: a listen that has finished, not one playing now. */
const LISTEN_TYPES = { single: 'single' } as const

/** ListenBrainz's `Authorization` scheme for a user token. */
const TOKEN_SCHEME = 'Token'

type ListenBrainzScrobblerValidateProps = { token: string }

type ListenBrainzScrobblerSendProps = { secret: string; listen: Listen }

type HeadersOfProps = { token: string }

const headersOf = ({ token }: HeadersOfProps): Record<string, string> => ({
  [AUTH_HEADERS.authorization]: `${TOKEN_SCHEME} ${token}`,
  [HEADERS.accept]: CONTENT_TYPES.json,
  [HEADERS.contentType]: CONTENT_TYPES.json,
  [HEADERS.userAgent]: RAVEN_USER_AGENT,
})

/** The submission ListenBrainz takes for `listen`, its ids only where the tags gave them. */
const submissionOf = (listen: Listen) => ({
  listen_type: LISTEN_TYPES.single,
  payload: [
    {
      listened_at: listen.listenedAt,
      track_metadata: {
        artist_name: listen.artist,
        track_name: listen.track,
        release_name: listen.album,
        additional_info: {
          ...(listen.durationSeconds === null
            ? {}
            : { duration_ms: Math.round(listen.durationSeconds * 1000) }),
          ...(listen.recordingMbid === null ? {} : { recording_mbid: listen.recordingMbid }),
          ...(listen.releaseMbid === null ? {} : { release_mbid: listen.releaseMbid }),
        },
      },
    },
  ],
})

/**
 * ListenBrainz, which needs no key of the server's: each account links with
 * its own user token, sent as `Authorization: Token`. The token is checked
 * with `validate-token`, which answers 200 with `valid` false for one it
 * does not know. The sender spaces the submissions; this sends one.
 */
@Injectable()
export class ListenBrainzScrobbler implements Scrobbler {
  constructor(
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
    @Inject(LISTENBRAINZ_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  isAvailable(): boolean {
    return true
  }

  async validate({ token }: ListenBrainzScrobblerValidateProps): Promise<LinkedAccount | null> {
    const response = await this.fetch({
      url: `${LISTENBRAINZ_API}${LISTENBRAINZ_ROUTES.validate}`,
      init: { headers: headersOf({ token }), signal: AbortSignal.timeout(this.timeoutMs) },
    })
    if (response.status === 400 || response.status === 401) return null
    if (!response.ok) throw new Error(`ListenBrainz answered ${response.status}.`)
    const body: unknown = await response.json()
    if (!isRecord(body) || !isBoolean(body.valid)) {
      throw new Error('ListenBrainz sent an unreadable answer.')
    }
    return body.valid && isString(body.user_name)
      ? { username: body.user_name, secret: token }
      : null
  }

  async send({ secret, listen }: ListenBrainzScrobblerSendProps): Promise<SendOutcome> {
    const response = await this.fetch({
      url: `${LISTENBRAINZ_API}${LISTENBRAINZ_ROUTES.submit}`,
      init: {
        method: HTTP_METHODS.post,
        headers: headersOf({ token: secret }),
        body: JSON.stringify(submissionOf(listen)),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    }).catch(() => null)
    return response === null ? SEND_OUTCOMES.retry : outcomeOfStatus(response.status)
  }
}
