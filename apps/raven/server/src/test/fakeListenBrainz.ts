import { AUTH_HEADERS } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { LB_FIELDS, LB_PARAMS, LISTENBRAINZ_API } from '@/music/listenBrainzClient'
import { LISTENBRAINZ_ROUTES } from '@/scrobbling/listenBrainzScrobbler'

type FakeSimilar = { mbid: string; name: string; score: number }

/** How the fake answers: as the live API does, never (until the call's signal gives up), or with a 429. */
export const FAKE_ANSWERS = { similar: 'similar', hang: 'hang', tooMany: 'tooMany' } as const

type FakeAnswer = (typeof FAKE_ANSWERS)[keyof typeof FAKE_ANSWERS]

type FakeListenBrainzProps = {
  /** What the labs API answers for each artist's MusicBrainz id; an artist it lacks gets an empty list. */
  similar?: Readonly<Record<string, readonly FakeSimilar[]>>
  answer?: FakeAnswer
  /** The user tokens the core API knows, each with its user's name. */
  users?: Readonly<Record<string, string>>
}

/** A submission the core API took: the token it came with, and its parsed body. */
type FakeSubmission = { token: string; body: unknown }

type JsonProps = { body: unknown; status?: number }

const json = ({ body, status = 200 }: JsonProps): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
  })

/**
 * ListenBrainz as a test's fetch. Its labs API's `similar-artists/json`
 * lists the artists `similar` names for the asked mbid, as the live one
 * does, or hangs or refuses as `answer` says. Its core API checks a token
 * against `users` (`validate-token` answers 200 with `valid` false for one
 * it does not know) and takes listens from a known token, answering 401 for
 * another, or `submitStatus` while one is set. Both fail as a network does
 * while `down`. Every request is remembered.
 */
export const fakeListenBrainz = ({
  similar = {},
  answer = FAKE_ANSWERS.similar,
  users = {},
}: FakeListenBrainzProps) => {
  const state: { isDown: boolean; submitStatus: number | null } = {
    isDown: false,
    submitStatus: null,
  }
  const requests: { url: string; userAgent: string | null }[] = []
  const submissions: FakeSubmission[] = []
  const core: MetadataFetch = async ({ url, init }) => {
    const token = (init.headers[AUTH_HEADERS.authorization] ?? '').replace(/^Token /u, '')
    const path = new URL(url).pathname
    if (path === LISTENBRAINZ_ROUTES.validate) {
      const user = users[token]
      return json({
        body:
          user === undefined
            ? { code: 200, message: 'Token invalid.', valid: false }
            : { code: 200, message: 'Token valid.', valid: true, user_name: user },
      })
    }
    if (path === LISTENBRAINZ_ROUTES.submit) {
      if (state.submitStatus !== null)
        return json({ body: { error: 'busy' }, status: state.submitStatus })
      if (users[token] === undefined)
        return json({ body: { code: 401, error: 'Invalid token' }, status: 401 })
      const body: unknown = JSON.parse(init.body ?? 'null')
      submissions.push({ token, body })
      return json({ body: { status: 'ok' } })
    }
    return json({ body: { error: 'Not found' }, status: 404 })
  }
  const fetch: MetadataFetch = async ({ url, init }) => {
    requests.push({ url, userAgent: init.headers[HEADERS.userAgent] ?? null })
    if (state.isDown) throw new TypeError('fetch failed')
    if (url.startsWith(LISTENBRAINZ_API)) return core({ url, init })
    if (answer === FAKE_ANSWERS.hang) {
      return new Promise<Response>((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    }
    if (answer === FAKE_ANSWERS.tooMany) return new Response('slow down', { status: 429 })
    const asked = new URL(url).searchParams.get(LB_PARAMS.artists) ?? ''
    const body = (similar[asked] ?? []).map((artist) => ({
      [LB_FIELDS.mbid]: artist.mbid,
      name: artist.name,
      comment: '',
      type: 'Group',
      gender: null,
      [LB_FIELDS.score]: artist.score,
      reference_mbid: asked,
    }))
    return json({ body })
  }
  type SetDownProps = { isDown: boolean }

  /** ListenBrainz away, or back. */
  const setDown = ({ isDown }: SetDownProps): void => {
    state.isDown = isDown
  }

  type SetSubmitStatusProps = { status: number | null }

  /** What the core API answers every submission with, or null to take them as the live one does. */
  const setSubmitStatus = ({ status }: SetSubmitStatusProps): void => {
    state.submitStatus = status
  }
  return { fetch, requests, submissions, setDown, setSubmitStatus }
}
