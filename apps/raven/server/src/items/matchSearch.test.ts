import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type MatchCandidate,
  isLibrary,
  isMatchCandidateList,
  isMediaList,
  isShowListing,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { ADMIN_PASSWORD, adminCookie, cookieSet, cookies } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { type FakeEpisode, fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = { statusCode: number; rawPayload: Buffer; json: () => unknown }

const shape = <T>({
  response,
  guard,
}: {
  response: Injected
  guard: (value: unknown) => value is T
}): T => {
  const body: unknown = response.json()
  if (!guard(body)) throw new Error(`Unexpected body: ${response.rawPayload.toString()}`)
  return body
}

const run = (count: number): FakeEpisode[] =>
  Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    title: `Episode ${index + 1}`,
    aired: '2004-04-07',
  }))

const isDetailsCall = (url: string): boolean => /^\/3\/(tv|movie)\/\d+$/.test(new URL(url).pathname)

describe('Fix match confidence', () => {
  const tmdb = fakeTmdb({
    movies: [
      { id: 501, title: 'Short Film', released: '2020-03-01', runtime: 1 },
      { id: 502, title: 'Short Film', released: '2021-05-01', runtime: 120 },
      { id: 503, title: 'Hidden Film', released: '2019-06-01', runtime: 1 },
      { id: 504, title: 'Night Train', released: '2019-02-01', runtime: 120 },
    ],
    shows: [
      { id: 30981, title: 'Monster', first: '2004-04-07', popularity: 50, seasons: { 1: run(74) } },
      { id: 65806, title: 'Monster', first: '2016-03-12', popularity: 10, seasons: { 1: run(50) } },
      // Ahead of better titles in TMDB's order, so the details read are the
      // five that score best, not TMDB's first five.
      { id: 51808, title: 'Robot and Monster', first: '2012-08-04', seasons: { 1: run(26) } },
      {
        id: 64198,
        title: 'Blaze and the Monster Machines',
        first: '2014-10-13',
        seasons: { 1: run(20) },
      },
      {
        id: 131532,
        title: 'Monster High',
        first: '2022-10-06',
        popularity: 80,
        seasons: { 1: run(13) },
      },
      { id: 69084, title: 'Monster Strike', first: '2015-10-10', seasons: { 1: run(12) } },
      { id: 15130, title: 'Monster Rancher', first: '1999-04-05', seasons: { 1: run(48) } },
      { id: 7101, title: 'Patriot', first: '2015-11-05', seasons: { 1: run(10) } },
      {
        id: 2316,
        title: 'The Office',
        first: '2005-03-24',
        countries: ['US'],
        popularity: 90,
        seasons: { 1: run(6) },
      },
      {
        id: 2996,
        title: 'The Office',
        first: '2001-07-09',
        countries: ['GB'],
        popularity: 30,
        seasons: { 1: run(6) },
      },
    ],
  })
  const state: {
    root: string
    admin: string
    app: NestFastifyApplication | null
    tv: number
    films: number
    vault: number
    cellar: number
    shows: number
  } = { root: '', admin: '', app: null, tv: 0, films: 0, vault: 0, cellar: 0, shows: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const search = async ({
    query,
    cookie,
  }: {
    query: string
    cookie?: string
  }): Promise<MatchCandidate[]> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/match/search?${query}`,
        headers: { cookie: cookie ?? state.admin },
      }),
      guard: isMatchCandidateList,
    })
  const scores = (candidates: readonly MatchCandidate[]) =>
    candidates.map((candidate) => [candidate.tmdbId, candidate.confidence])
  const mediaOf = async ({ library, cookie }: { library: number; cookie?: string }) =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${library}/media`,
        ...(cookie == null ? {} : { headers: { cookie } }),
      }),
      guard: isMediaList,
    })
  const fileNamed = async ({
    library,
    name,
    cookie,
  }: {
    library: number
    name: string
    cookie?: string
  }) => {
    const found = (await mediaOf({ library, cookie })).find((file) => file.fileName === name)
    if (!found) throw new Error(`No file ${name}`)
    return found
  }

  const NO_SUBJECT = [
    ['30981', 100],
    ['65806', 68],
    ['131532', 47],
    ['69084', 40],
    ['15130', 37],
    ['51808', 33],
    ['64198', 19],
  ]
  const ON_DISK = [
    ['30981', 79],
    ['65806', 79],
    ['15130', 37],
    ['51808', 33],
    ['131532', 28],
    ['69084', 24],
    ['64198', 19],
  ]

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-confidence-'))
    const tv = join(state.root, 'TV')
    const films = join(state.root, 'Films')
    const vault = join(state.root, 'Vault')
    const cellar = join(state.root, 'Cellar')
    const shows = join(state.root, 'Shows')
    await Promise.all([
      encodeClip({ path: join(tv, 'Monster', 'Season 1', 'Monster - S01E01.mp4'), seconds: 1 }),
      encodeClip({ path: join(tv, 'Monster', 'Season 1', 'Monster - S01E35.mp4'), seconds: 1 }),
      encodeClip({ path: join(films, 'Short Film (2020)', 'Short Film (2020).mp4'), seconds: 1 }),
      encodeClip({ path: join(vault, 'Monster', 'Season 1', 'Monster - S01E35.mp4'), seconds: 1 }),
      // Larger than the Films copy, so it is the movie's best file.
      encodeClip({
        path: join(cellar, 'Short Film (2020)', 'Short Film (2020).mp4'),
        seconds: 1,
        size: '640x480',
      }),
      encodeClip({
        path: join(cellar, 'Hidden Film (2019)', 'Hidden Film (2019).mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(films, 'Night Train (2019)', 'Night Train (2019) {edition-Extended}.mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(shows, 'The Office (UK)', 'Season 1', 'The Office (UK) - S01E01.mp4'),
        seconds: 1,
      }),
      encodeClip({ path: join(shows, 'Monster', 'Season 1', 'Monster - S01E01.mp4'), seconds: 1 }),
      encodeClip({ path: join(shows, 'Monster', 'Trailers', 'Monster - S02E01.mp4'), seconds: 1 }),
    ])
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        hwAccel: 'none',
        dataDir: join(state.root, 'data'),
        webDir: null,
        browseRoot: state.root,
        scanOnStart: false,
        rescanIntervalMinutes: 0,
        tmdbApiToken: 'test-token',
        libraryPin: '3001',
        adminPassword: ADMIN_PASSWORD,
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(app())
    const create = async (payload: Record<string, unknown>) =>
      shape({
        response: await app().inject({
          method: 'POST',
          url: '/api/libraries',
          headers: { cookie: state.admin },
          payload,
        }),
        guard: isLibrary,
      }).id
    state.tv = await create({ name: 'TV', paths: [tv], settings: { kind: 'shows' } })
    state.films = await create({ name: 'Films', paths: [films], settings: { kind: 'movies' } })
    state.vault = await create({
      name: 'Vault',
      paths: [vault],
      settings: { kind: 'shows', locked: true },
    })
    state.cellar = await create({
      name: 'Cellar',
      paths: [cellar],
      settings: { kind: 'movies', locked: true },
    })
    state.shows = await create({ name: 'Shows', paths: [shows], settings: { kind: 'shows' } })
    await Promise.all(
      [state.tv, state.films, state.vault, state.cellar, state.shows].map((id) =>
        app().get(ScannerService).whenIdle(id),
      ),
    )
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('reads the details of the top five only, and none when asked again', async () => {
    const before = tmdb.state.calls.length
    expect(scores(await search({ query: 'type=show&query=Monster' }))).toEqual(NO_SUBJECT)
    const asked = tmdb.state.calls.slice(before).filter(isDetailsCall)
    expect(asked.map((url) => new URL(url).pathname).toSorted()).toEqual(
      ['/3/tv/131532', '/3/tv/15130', '/3/tv/30981', '/3/tv/65806', '/3/tv/69084'].toSorted(),
    )
    const again = tmdb.state.calls.length
    await search({ query: 'type=show&query=Monster' })
    expect(tmdb.state.calls.slice(again).filter(isDetailsCall)).toEqual([])
  })

  it('scores a show folder against its episodes on disk, by a file or by the show', async () => {
    const file = await fileNamed({ library: state.tv, name: 'Monster - S01E35.mp4' })
    expect(scores(await search({ query: `type=show&query=Monster&mediaId=${file.id}` }))).toEqual(
      ON_DISK,
    )
    const listing = shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${state.tv}/shows` }),
      guard: isShowListing,
    })
    const showId = listing.shows[0]?.show.id
    expect(showId).toBeDefined()
    expect(scores(await search({ query: `type=show&query=Monster&itemId=${showId}` }))).toEqual(
      ON_DISK,
    )
  })

  it("scores a movie against its file's duration, best first", async () => {
    const film = await fileNamed({ library: state.films, name: 'Short Film (2020).mp4' })
    expect(film.duration).not.toBeNull()
    expect(scores(await search({ query: 'type=movie&query=Short%20Film&year=2020' }))).toEqual([
      ['501', 79],
      ['502', 79],
    ])
    expect(
      scores(await search({ query: `type=movie&query=Short%20Film&year=2020&mediaId=${film.id}` })),
    ).toEqual([
      ['501', 100],
      ['502', 40],
    ])
  })

  it('scores a subject in a library this browser may not see as if there were none', async () => {
    const admin = await adminCookie(app())
    const pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
    const unlocked = cookies(admin, pin)
    const hidden = await fileNamed({
      library: state.vault,
      name: 'Monster - S01E35.mp4',
      cookie: unlocked,
    })
    const query = `type=show&query=Monster&mediaId=${hidden.id}`
    expect(scores(await search({ query }))).toEqual(NO_SUBJECT)
    expect(scores(await search({ query, cookie: unlocked }))).toEqual(ON_DISK)
  })

  it('scores a movie by the best of its files this browser may see', async () => {
    const admin = await adminCookie(app())
    const pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
    const film = await fileNamed({ library: state.films, name: 'Short Film (2020).mp4' })
    const hidden = await fileNamed({
      library: state.cellar,
      name: 'Short Film (2020).mp4',
      cookie: cookies(admin, pin),
    })
    const itemId = film.item?.id
    expect(itemId).toBeDefined()
    expect(hidden.item?.id).toBe(itemId)
    expect(
      scores(await search({ query: `type=movie&query=Short%20Film&year=2020&itemId=${itemId}` })),
    ).toEqual([
      ['501', 100],
      ['502', 40],
    ])
  })

  it('scores a movie whose every file is hidden from this browser as if there were none', async () => {
    const admin = await adminCookie(app())
    const pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
    const unlocked = cookies(admin, pin)
    const hidden = await fileNamed({
      library: state.cellar,
      name: 'Hidden Film (2019).mp4',
      cookie: unlocked,
    })
    expect(hidden.item).not.toBeNull()
    // Its 1-second file fits 501 and rules out 502, so the scores show whether it was read.
    const query = `type=movie&query=Short%20Film&year=2020&itemId=${hidden.item?.id}`
    expect(scores(await search({ query }))).toEqual([
      ['501', 79],
      ['502', 79],
    ])
    expect(scores(await search({ query, cookie: unlocked }))).toEqual([
      ['501', 100],
      ['502', 40],
    ])
  })

  it('searches and scores a typed country suffix as the country, not as part of the title', async () => {
    expect(scores(await search({ query: 'type=show&query=The%20Office' }))).toEqual([
      ['2316', 100],
      ['2996', 73],
    ])
    const typed = `type=show&query=${encodeURIComponent('The Office (UK)')}`
    expect(scores(await search({ query: typed }))).toEqual([
      ['2996', 100],
      ['2316', 40],
    ])
  })

  it("takes the country from a show folder's suffix when none is typed, and a typed one first", async () => {
    const file = await fileNamed({ library: state.shows, name: 'The Office (UK) - S01E01.mp4' })
    expect(
      scores(await search({ query: `type=show&query=The%20Office&mediaId=${file.id}` })),
    ).toEqual([
      ['2996', 100],
      ['2316', 40],
    ])
    const typed = `type=show&query=${encodeURIComponent('The Office (US)')}&mediaId=${file.id}`
    expect(scores(await search({ query: typed }))).toEqual([
      ['2316', 100],
      ['2996', 40],
    ])
  })

  it("leaves an extra out of a show folder's fit", async () => {
    const trailer = await fileNamed({ library: state.shows, name: 'Monster - S02E01.mp4' })
    expect(trailer.match).toBe('off')
    // No show here has a season 2, so the trailer, were it read, would hold every one at 40.
    const file = await fileNamed({ library: state.shows, name: 'Monster - S01E01.mp4' })
    expect(scores(await search({ query: `type=show&query=Monster&mediaId=${file.id}` }))).toEqual([
      ['30981', 79],
      ['65806', 79],
      ['131532', 47],
      ['69084', 40],
      ['15130', 37],
      ['51808', 33],
      ['64198', 19],
    ])
  })

  it('measures no runtime fit for a file that names an edition', async () => {
    const cut = await fileNamed({
      library: state.films,
      name: 'Night Train (2019) {edition-Extended}.mp4',
    })
    expect(cut.edition).toBe('Extended')
    // A 1 second cut against a 120 minute runtime would, measured, be held at 40.
    const query = `type=movie&query=Night%20Train&year=2019&mediaId=${cut.id}`
    expect(scores(await search({ query }))).toEqual([['504', 100]])
  })

  it('answers when a details call fails, scoring that result without it', async () => {
    // Patriot has 10 episodes, so the Monster folder's S01E35 holds it at 40 once its details are read.
    const file = await fileNamed({ library: state.tv, name: 'Monster - S01E35.mp4' })
    const query = `type=show&query=Patriot&mediaId=${file.id}`
    tmdb.state.failing.push('/tv/7101')
    try {
      expect(scores(await search({ query }))).toEqual([['7101', 100]])
    } finally {
      tmdb.state.failing.splice(0)
    }
    expect(scores(await search({ query }))).toEqual([['7101', 40]])
  })

  it('treats a file raven no longer has as no subject', async () => {
    expect(scores(await search({ query: 'type=show&query=Monster&mediaId=999999' }))).toEqual(
      NO_SUBJECT,
    )
  })

  it('refuses both a file and a show, or an id that is not one', async () => {
    const statusOf = async (query: string) =>
      (
        await app().inject({
          method: 'GET',
          url: `/api/match/search?type=show&query=Monster&${query}`,
          headers: { cookie: state.admin },
        })
      ).statusCode
    expect(await statusOf('mediaId=1&itemId=2')).toBe(400)
    expect(await statusOf('mediaId=abc')).toBe(400)
    expect(await statusOf('itemId=1.5')).toBe(400)
  })
})
