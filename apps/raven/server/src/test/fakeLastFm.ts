import { CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@shared/server'
import type { LastFmKeys } from '@/config'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import {
  LASTFM_API,
  LASTFM_ERRORS,
  LASTFM_METHODS,
  LASTFM_PARAMS,
  signed,
} from '@/scrobbling/lastFmScrobbler'

/** raven's Last.fm keys in the tests. */
export const FAKE_LASTFM_KEYS: LastFmKeys = { apiKey: 'fm-key-0001', apiSecret: 'fm-secret-0001' }

type FakeLastFmProps = {
  /** The sign-in tokens Last.fm's page would hand out, each with the user who allowed raven. */
  tokens?: Readonly<Record<string, string>>
}

type JsonProps = { body: unknown; status?: number }

const json = ({ body, status = 200 }: JsonProps): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
  })

/** The form fields of a call, without the signature, as Last.fm signs them. */
const fieldsOf = (form: URLSearchParams): Record<string, string> =>
  Object.fromEntries([...form.entries()].filter(([name]) => name !== LASTFM_PARAMS.apiSig))

/**
 * Last.fm's API as a test's fetch, on `FAKE_LASTFM_KEYS`. Every call must
 * be a form POST signed as Last.fm checks it (error 13 otherwise).
 * `auth.getSession` trades each of `tokens` once for a session key named
 * after it (error 4 for one it does not know or has used); `track.scrobble`
 * takes a scrobble with a live session key (error 9 otherwise), or answers
 * `scrobbleError` while one is set. Every scrobble taken is remembered.
 */
export const fakeLastFm = ({ tokens = {} }: FakeLastFmProps = {}) => {
  const used = new Set<string>()
  const sessions = new Map<string, string>()
  const scrobbles: Record<string, string>[] = []
  const state: { scrobbleError: number | null } = { scrobbleError: null }
  const fetch: MetadataFetch = async ({ url, init }) => {
    if (url !== LASTFM_API || init.method !== HTTP_METHODS.post) {
      return json({ body: { error: 3, message: 'Invalid method' }, status: 400 })
    }
    const form = new URLSearchParams(init.body ?? '')
    const fields = fieldsOf(form)
    const expected = signed({ params: fields, keys: FAKE_LASTFM_KEYS })[LASTFM_PARAMS.apiSig]
    if (
      fields[LASTFM_PARAMS.apiKey] !== FAKE_LASTFM_KEYS.apiKey ||
      form.get(LASTFM_PARAMS.apiSig) !== expected
    ) {
      return json({ body: { error: 13, message: 'Invalid method signature' }, status: 403 })
    }
    if (fields.method === LASTFM_METHODS.getSession) {
      const token = fields.token ?? ''
      const user = tokens[token]
      if (user === undefined || used.has(token)) {
        return json({
          body: { error: LASTFM_ERRORS.invalidToken, message: 'Invalid token' },
          status: 403,
        })
      }
      used.add(token)
      const key = `session-of-${token}`
      sessions.set(key, user)
      return json({ body: { session: { name: user, key, subscriber: 0 } } })
    }
    if (fields.method === LASTFM_METHODS.scrobble) {
      if (state.scrobbleError !== null) {
        return json({ body: { error: state.scrobbleError, message: 'No' }, status: 503 })
      }
      if (!sessions.has(fields.sk ?? '')) {
        return json({
          body: { error: LASTFM_ERRORS.invalidSession, message: 'Invalid session key' },
          status: 403,
        })
      }
      scrobbles.push(fields)
      return json({ body: { scrobbles: { '@attr': { accepted: 1, ignored: 0 } } } })
    }
    return json({ body: { error: 3, message: 'Invalid method' }, status: 400 })
  }

  type SetScrobbleErrorProps = { error: number | null }

  /** The error every scrobble is answered with, or null to take them. */
  const setScrobbleError = ({ error }: SetScrobbleErrorProps): void => {
    state.scrobbleError = error
  }
  return { fetch, scrobbles, setScrobbleError }
}
