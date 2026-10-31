import { CONTENT_TYPES, HEADERS } from '@shared/server'
import type { MetadataFetch } from '@/metadata/tmdbClient'

type FakeSimilar = { mbid: string; name: string; score: number }

/** How the fake answers: as the live API does, never (until the call's signal gives up), or with a 429. */
export const FAKE_ANSWERS = { similar: 'similar', hang: 'hang', tooMany: 'tooMany' } as const

type FakeAnswer = (typeof FAKE_ANSWERS)[keyof typeof FAKE_ANSWERS]

type FakeListenBrainzProps = {
  /** What the labs API answers for each artist's MusicBrainz id; an artist it lacks gets an empty list. */
  similar: Readonly<Record<string, readonly FakeSimilar[]>>
  answer?: FakeAnswer
}

/**
 * ListenBrainz's labs API as a test's fetch: `similar-artists/json` lists
 * the artists `similar` names for the asked mbid, as the live one does, or
 * fails as a network does while `down`, or hangs or refuses as `answer`
 * says. Every request is remembered.
 */
export const fakeListenBrainz = ({
  similar,
  answer = FAKE_ANSWERS.similar,
}: FakeListenBrainzProps) => {
  const state = { isDown: false }
  const requests: { url: string; userAgent: string | null }[] = []
  const fetch: MetadataFetch = async ({ url, init }) => {
    requests.push({ url, userAgent: init.headers[HEADERS.userAgent] ?? null })
    if (state.isDown) throw new TypeError('fetch failed')
    if (answer === FAKE_ANSWERS.hang) {
      return new Promise<Response>((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    }
    if (answer === FAKE_ANSWERS.tooMany) return new Response('slow down', { status: 429 })
    const asked = new URL(url).searchParams.get('artist_mbids') ?? ''
    const body = (similar[asked] ?? []).map((artist) => ({
      artist_mbid: artist.mbid,
      name: artist.name,
      comment: '',
      type: 'Group',
      gender: null,
      score: artist.score,
      reference_mbid: asked,
    }))
    return new Response(JSON.stringify(body), {
      headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
    })
  }
  type SetDownProps = { isDown: boolean }

  /** ListenBrainz away, or back. */
  const setDown = ({ isDown }: SetDownProps): void => {
    state.isDown = isDown
  }
  return { fetch, requests, setDown }
}
