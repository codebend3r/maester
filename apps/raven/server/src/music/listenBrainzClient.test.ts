import { describe, expect, it } from 'vitest'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import {
  DEFAULT_LISTENBRAINZ_TIMEOUT_MS,
  LISTENBRAINZ_AWAY_MS,
  LISTENBRAINZ_LABS,
  LB_PARAMS,
  ListenBrainzClient,
} from '@/music/listenBrainzClient'
import { STILL_CLOCK, manualClock } from '@/test/clock'
import { FAKE_ANSWERS, fakeListenBrainz } from '@/test/fakeListenBrainz'

const SEED = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const NIRVANA = '5b11f4ce-a62d-471e-81fc-a69a8278c7da'
const MUSE = '9c9f1380-2516-4fc9-a3e6-f9f61941d090'

describe('ListenBrainzClient', () => {
  it('asks the labs API for the seed’s similar artists, closest first, naming raven', async () => {
    const fake = fakeListenBrainz({
      similar: {
        [SEED]: [
          { mbid: MUSE, name: 'Muse', score: 10286 },
          { mbid: NIRVANA, name: 'Nirvana', score: 11156 },
        ],
      },
    })
    const similar = await new ListenBrainzClient(
      fake.fetch,
      STILL_CLOCK,
      DEFAULT_LISTENBRAINZ_TIMEOUT_MS,
    ).similarArtists(SEED)

    expect(similar).toEqual([
      { mbid: NIRVANA, score: 11156 },
      { mbid: MUSE, score: 10286 },
    ])
    const [request] = fake.requests
    const url = new URL(request?.url ?? '')
    expect(`${url.origin}${url.pathname}`).toBe(`${LISTENBRAINZ_LABS}/similar-artists/json`)
    expect(url.searchParams.get(LB_PARAMS.artists)).toBe(SEED)
    expect(url.searchParams.get(LB_PARAMS.algorithm)).toMatch(/^session_based_days_7500_/)
    expect(request?.userAgent).toMatch(
      /^raven\/\S+ \(https:\/\/github\.com\/codebend3r\/maester\)$/,
    )
  })

  it('skips what it cannot read, and fails when ListenBrainz is down, errs or sends no list', async () => {
    const odd: MetadataFetch = async () =>
      new Response(
        JSON.stringify([
          { artist_mbid: 'nope', score: 1 },
          { artist_mbid: MUSE, score: 2 },
        ]),
      )
    await expect(
      new ListenBrainzClient(odd, STILL_CLOCK, DEFAULT_LISTENBRAINZ_TIMEOUT_MS).similarArtists(
        SEED,
      ),
    ).resolves.toEqual([{ mbid: MUSE, score: 2 }])
    const down = fakeListenBrainz({ similar: {} })
    down.setDown({ isDown: true })
    const broken: MetadataFetch = async () => new Response('oops', { status: 500 })
    const notList: MetadataFetch = async () => new Response('{}')
    const failures = await Promise.all(
      [down.fetch, broken, notList].map((fetch) =>
        new ListenBrainzClient(fetch, STILL_CLOCK, DEFAULT_LISTENBRAINZ_TIMEOUT_MS)
          .similarArtists(SEED)
          .then(
            () => null,
            (error: unknown) => error instanceof Error,
          ),
      ),
    )
    expect(failures).toEqual([true, true, true])
  })

  it('leaves ListenBrainz alone for a while after a timeout or a 429, asking nothing meanwhile', async () => {
    const hung = fakeListenBrainz({ similar: {}, answer: FAKE_ANSWERS.hang })
    const refused = fakeListenBrainz({ similar: {}, answer: FAKE_ANSWERS.tooMany })
    await Promise.all(
      [hung, refused].map(async (fake) => {
        const clock = manualClock()
        const client = new ListenBrainzClient(fake.fetch, clock.clock, 50)
        await expect(client.similarArtists(SEED)).rejects.toThrow()
        expect(client.isAway).toBe(true)
        await expect(client.similarArtists(SEED)).rejects.toThrow()
        expect(fake.requests).toHaveLength(1)
        clock.advance(LISTENBRAINZ_AWAY_MS)
        expect(client.isAway).toBe(false)
      }),
    )
  })
})
