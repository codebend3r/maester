import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type Library,
  type MediaItem,
  isItemDetails,
  isItemImageOptions,
  isItemMetadataState,
  isLibrary,
  isMatchCandidateList,
  isMediaItem,
  isMediaList,
  isMetadataHealth,
  isRecord,
  isSagaList,
  sagaBackdrop,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { MatchFiles } from '@/metadata/matchFiles'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { type InjectOptions, adminCookie, injectAs, testConfig } from '@/test/app'
import { encodeClip, encodeImage } from '@/test/clips'
import { FAKE_JPEG, fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = {
  statusCode: number
  rawPayload: Buffer
  headers: Record<string, unknown>
  json: () => unknown
}

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

/** Two of the films in one collection, as TMDB has none that fits them both. */
const CRIME_SAGA = { id: 9001, name: 'Crime Classics Collection' }

/** As a browser with the admin lock off, so files can be matched and items edited. */
describe('movie metadata', () => {
  const tmdb = fakeTmdb({
    movies: [
      {
        id: 603,
        title: 'The Matrix',
        released: '1999-03-31',
        imdbId: 'tt0133093',
        saga: { id: 2344, name: 'The Matrix Collection' },
      },
      { id: 949, title: 'Heat', released: '1995-12-15', saga: CRIME_SAGA },
      { id: 680, title: 'Pulp Fiction', released: '1994-09-10', saga: CRIME_SAGA },
      { id: 11, title: 'Unknown Thing One', released: '2020-01-01' },
      { id: 12, title: 'Unknown Thing Two', released: '2020-06-01' },
      { id: 881, title: 'A Few Good Men', released: '1992-12-11' },
      { id: 861072, title: "Don't Make Me Go", released: '2022-06-13' },
    ],
    omdb: { tt0133093: { imdb: '8.7/10', rottenTomatoes: '83%', metacritic: '73/100' } },
  })
  const state: {
    root: string
    media: string
    data: string
    admin: string
    app: NestFastifyApplication | null
    library: number
  } = { root: '', media: '', data: '', admin: '', app: null, library: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** A request by hand as the admin, for a route the admin lock holds back. */
  const asAdmin = (options: InjectOptions) => injectAs({ app: app(), cookie: state.admin })(options)
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const list = async (query = ''): Promise<MediaItem[]> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/media${query}`,
      }),
      guard: isMediaList,
    })
  /** A file by name, whether it is listed or one of a movie's other versions. */
  const byFile = async (fileName: string): Promise<MediaItem> => {
    const listed = await list()
    const versions = await Promise.all(
      listed.flatMap((item) =>
        item.item
          ? [
              app()
                .inject({ method: 'GET', url: `/api/items/${item.item.id}` })
                .then((response) => shape({ response, guard: isItemDetails }).versions),
            ]
          : [],
      ),
    )
    const found = [...listed, ...versions.flat()].find((item) => item.fileName === fileName)
    if (!found) throw new Error(`No ${fileName}`)
    return found
  }
  const sagaTitles = async () =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/sagas`,
      }),
      guard: isSagaList,
    }).map((saga) => ({
      name: saga.name,
      titles: saga.media.map((media) => media.item?.title ?? media.title),
    }))
  const rescan = async () => {
    await asAdmin({ method: 'POST', url: `/api/libraries/${state.library}/scan` })
    await settle()
  }
  const setKind = async (kind: string): Promise<Library> =>
    shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/libraries/${state.library}`,
        payload: { name: 'Films', paths: [state.media], settings: { kind } },
      }),
      guard: isLibrary,
    })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-metadata-'))
    state.media = join(state.root, 'Movies')
    state.data = join(state.root, 'data')
    const matrix = join(state.media, 'The Matrix (1999)')
    await Promise.all([
      encodeClip({ path: join(matrix, 'The Matrix (1999) Bluray-1080p.mp4'), seconds: 2 }),
      encodeClip({
        path: join(matrix, 'The Matrix (1999) Remux-2160p.mp4'),
        seconds: 2,
        size: '640x360',
      }),
      encodeClip({ path: join(matrix, 'Featurettes', 'Making Of.mp4'), seconds: 1 }),
      encodeImage({ path: join(matrix, 'poster.jpg') }),
      encodeClip({ path: join(state.media, 'Heat (1995) {tmdb-949}', 'Heat.mp4'), seconds: 1 }),
      encodeClip({
        path: join(state.media, 'Pulp.Fiction.1994.1080p.BluRay.x264.mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.media, 'The Few Good Men (1992)', 'The Few Good Men (1992).mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.media, 'Unknown Thing (2020)', 'Unknown Thing (2020).mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.media, 'Dont Make Me (2022)', "Don't Make Me Go (2022).mp4"),
        seconds: 1,
      }),
    ])
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: state.data, mediaDir: state.root }),
        tmdbApiToken: 'test-token',
        omdbApiKey: 'omdb-key',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
    const created = shape({
      response: await asAdmin({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'Films', paths: [state.media], settings: { kind: 'movies' } },
      }),
      guard: isLibrary,
    })
    state.library = created.id
    await settle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('lists one card per movie, its best version, with parsed and matched titles', async () => {
    const items = await list()
    expect(
      items.map((item) => [item.item?.title ?? item.title, item.match, item.versions]),
    ).toEqual([
      ["Don't Make Me Go", 'matched', 1],
      ['A Few Good Men', 'matched', 1],
      ['Heat', 'matched', 1],
      ['Making Of', 'off', 1],
      ['The Matrix', 'matched', 2],
      ['Pulp Fiction', 'matched', 1],
      ['Unknown Thing', 'unmatched', 1],
    ])
    const matrix = items.find((item) => item.item?.title === 'The Matrix')
    expect(matrix).toMatchObject({
      fileName: 'The Matrix (1999) Remux-2160p.mp4',
      year: 1999,
      width: 640,
    })
    expect(items.find((item) => item.title === 'Unknown Thing')?.year).toBe(2020)
  })

  it("gives a matched card its movie's backdrop version, and none to a file matched to nothing", async () => {
    const items = await list()
    const heat = items.find((item) => item.item?.title === 'Heat')
    expect(heat?.item?.backdropVersion).toEqual(expect.any(String))
    expect(items.find((item) => item.title === 'Unknown Thing')?.item).toBeNull()
  })

  it('starts a Movies library grouped into matched and not', async () => {
    const library = shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${state.library}` }),
      guard: isLibrary,
    })
    expect(library.settings).toMatchObject({ kind: 'movies', view: 'grouped', groupBy: 'match' })
  })

  it('gathers the movies of one TMDB collection into a saga, oldest first, and no lone one', async () => {
    expect(await sagaTitles()).toEqual([
      { name: 'Crime Classics Collection', titles: ['Pulp Fiction', 'Heat'] },
    ])
  })

  it("gives a saga its first movie's backdrop, for its page", async () => {
    const response = await app().inject({
      method: 'GET',
      url: `/api/libraries/${state.library}/sagas`,
    })
    const [saga] = shape({ response, guard: isSagaList })
    const first = saga?.media[0]?.item
    expect(first?.backdropVersion).toEqual(expect.any(String))
    expect(saga && sagaBackdrop(saga)).toEqual({
      id: first?.id,
      version: first?.backdropVersion,
      title: first?.title,
    })
  })

  it("keeps the backdrop an admin picks for a saga: a slideshow's motion, or one of its movies held still", async () => {
    const url = `/api/libraries/${state.library}/sagas`
    const sagas = async () =>
      shape({ response: await app().inject({ method: 'GET', url }), guard: isSagaList })
    const [saga] = await sagas()
    expect(saga?.backdrop).toEqual({ type: 'slideshow', motion: 'fade' })
    const heat = saga?.media.find((media) => media.item?.title === 'Heat')?.item
    const pick = (payload: InjectOptions['payload'], sagaId = saga?.tmdbId ?? '') =>
      asAdmin({ method: 'PUT', url: `${url}/${sagaId}/backdrop`, payload })

    const still = { type: 'still', itemId: heat?.id }
    expect((await pick(still)).json()).toEqual(still)
    expect((await sagas())[0]?.backdrop).toEqual(still)
    const slideshow = { type: 'slideshow', motion: 'kenBurns' }
    expect((await pick(slideshow)).json()).toEqual(slideshow)
    expect((await sagas())[0]?.backdrop).toEqual(slideshow)

    expect((await pick({ type: 'still', itemId: 999_999 })).statusCode).toBe(400)
    expect((await pick({ type: 'slideshow', motion: 'spin' })).statusCode).toBe(400)
    expect((await pick(slideshow, '2344')).statusCode).toBe(404)
    const viewer = await app().inject({
      method: 'PUT',
      url: `${url}/${saga?.tmdbId}/backdrop`,
      payload: still,
    })
    expect(viewer.statusCode).toBe(403)
    expect((await sagas())[0]?.backdrop).toEqual(slideshow)
  })

  it("serves a movie's logo for its page, and learns an older movie's in the sweep", async () => {
    const heat = await byFile('Heat.mp4')
    const logoOf = async () =>
      shape({
        response: await app().inject({ method: 'GET', url: `/api/items/${heat.item?.id}` }),
        guard: isItemDetails,
      }).logoVersion
    const version = await logoOf()
    expect(version).toEqual(expect.any(String))
    const logo = await app().inject({
      method: 'GET',
      url: `/api/items/${heat.item?.id}/images/logo?v=${version}`,
    })
    expect(logo.statusCode).toBe(200)
    expect(logo.headers['content-type']).toBe('image/png')

    const db = app().get(DatabaseService).db
    db.prepare("DELETE FROM item_images WHERE kind = 'logo'").run()
    db.prepare("UPDATE items SET logo_checked = 0 WHERE type = 'movie'").run()
    expect(await logoOf()).toBeNull()
    await app().get(ItemRefresher).sweep()
    expect(await logoOf()).toBe(version)
  })

  it('lists the files no movie was found for', async () => {
    const response = await app().inject({
      method: 'GET',
      url: `/api/libraries/${state.library}/unmatched`,
    })
    expect(shape({ response, guard: isMediaList }).map((item) => item.title)).toEqual([
      'Unknown Thing',
    ])
  })

  it('learns the saga and logo of a movie stored before they were kept, in one call, once', async () => {
    const db = app().get(DatabaseService).db
    db.prepare(
      `UPDATE items SET saga_tmdb_id = NULL, saga_name = NULL, saga_checked = 0, logo_checked = 0
        WHERE type = 'movie'`,
    ).run()
    expect(await sagaTitles()).toEqual([])
    const movies = db
      .prepare<[], { tmdb_id: string }>("SELECT tmdb_id FROM items WHERE type = 'movie'")
      .all()
      .map((row) => `/3/movie/${row.tmdb_id}`)
    const askedFrom = (start: number) =>
      tmdb.state.calls
        .slice(start)
        .filter((url) => url.includes('/movie/'))
        .map((url) => new URL(url).pathname)
    const before = tmdb.state.calls.length
    await app().get(ItemRefresher).sweep()
    expect(await sagaTitles()).toEqual([
      { name: 'Crime Classics Collection', titles: ['Pulp Fiction', 'Heat'] },
    ])
    expect(askedFrom(before).toSorted()).toEqual(movies.toSorted())
    const after = tmdb.state.calls.length
    await app().get(ItemRefresher).sweep()
    expect(askedFrom(after)).toEqual([])
  })

  it('asked again without the article when "The Few Good Men" found nothing', () => {
    const asked = tmdb.state.calls
      .filter((url) => url.includes('/search/movie'))
      .map((url) => new URL(url).searchParams.get('query'))
    expect(asked).toContain('The Few Good Men')
    expect(asked).toContain('Few Good Men')
  })

  it("matched a misnamed folder by its file's own name once the folder's found nothing", () => {
    const asked = tmdb.state.calls
      .filter((url) => url.includes('/search/movie'))
      .map((url) => new URL(url).searchParams.get('query'))
    expect(asked).toContain('Dont Make Me')
    expect(asked).toContain("Don't Make Me Go")
  })

  it('matched Heat by the id in its folder name, without a search', () => {
    expect(
      tmdb.state.calls.some((url) => url.includes('/search/movie') && url.includes('Heat')),
    ).toBe(false)
  })

  it('serves the movie page with its credits and every version', async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    const details = shape({
      response: await app().inject({ method: 'GET', url: `/api/items/${matrix?.item?.id}` }),
      guard: isItemDetails,
    })
    expect(details).toMatchObject({
      tmdbId: '603',
      imdbId: 'tt0133093',
      contentRating: 'R',
      genres: ['Action', 'Science Fiction'],
    })
    expect(details.credits.map((credit) => `${credit.name}:${credit.job}`)).toEqual([
      'Keanu Reeves:cast',
      'Laurence Fishburne:cast',
      'Lilly Wachowski:director',
      'Lana Wachowski:director',
      'Lilly Wachowski:writer',
    ])
    expect(details.versions.map((version) => version.width)).toEqual([640, 320])
    expect(details.posterVersion).not.toBeNull()
    expect(details.backdropVersion).not.toBeNull()
  })

  it("carries OMDb's scores for a movie with an IMDb id, and only TMDB's for the rest", async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    expect(matrix?.item?.ratings.map((rating) => [rating.source, rating.value])).toEqual([
      ['rottenTomatoes', 8.3],
      ['imdb', 8.7],
      ['metacritic', 7.3],
      ['tmdb', 8.2],
    ])
    const heat = (await list()).find((item) => item.item?.title === 'Heat')
    expect(heat?.item?.ratings.map((rating) => rating.source)).toEqual(['tmdb'])
    expect(tmdb.state.omdbCalls).toBe(1)
  })

  it("sorts by the library's chosen score, falling back to TMDB's", async () => {
    const put = async (ratingsSource: string) =>
      asAdmin({
        method: 'PUT',
        url: `/api/libraries/${state.library}`,
        payload: { name: 'Films', paths: [state.media], settings: { ratingsSource } },
      })
    expect((await put('rottenTomatoes')).statusCode).toBe(200)
    const high = await list('?sort=rating-high')
    expect(high[0]?.item?.title).toBe('The Matrix')
    expect(high.at(-1)?.match).toBe('unmatched')
    const low = await list('?sort=rating-low')
    expect(low.find((item) => item.item)?.item?.title).not.toBe('The Matrix')
    await put('tmdb')
  })

  it('keeps reviews by TMDB members, newest first, as plain text, with only TMDB avatars', async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    const details = shape({
      response: await app().inject({ method: 'GET', url: `/api/items/${matrix?.item?.id}` }),
      guard: isItemDetails,
    })
    expect(
      details.reviews.map((review) => [review.author, review.rating, review.avatarVersion != null]),
    ).toEqual([
      ['latecomer', null, false],
      ['A Film Fan', 8, true],
    ])
    expect(details.reviews[0]?.content).toBe('<b>Not</b> for me.')
    const avatar = await app().inject({
      method: 'GET',
      url: `/api/reviews/${details.reviews[1]?.id}/avatar?v=${details.reviews[1]?.avatarVersion}`,
    })
    expect(avatar.statusCode).toBe(200)
    expect(avatar.rawPayload.equals(FAKE_JPEG)).toBe(true)
  })

  it("serves a person's page with what raven holds of theirs", async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    const details = shape({
      response: await app().inject({ method: 'GET', url: `/api/items/${matrix?.item?.id}` }),
      guard: isItemDetails,
    })
    const keanu = details.credits.find((credit) => credit.name === 'Keanu Reeves')
    const response = await app().inject({ method: 'GET', url: `/api/people/${keanu?.personId}` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      name: 'Keanu Reeves',
      credits: expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ title: 'The Matrix' }),
          job: 'cast',
          role: 'Neo',
        }),
      ]),
    })
    expect((await app().inject({ method: 'GET', url: '/api/people/99999' })).statusCode).toBe(404)
  })

  it("serves the poster beside the movie, scaled, and TMDB's backdrop from the cache", async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    const poster = await app().inject({
      method: 'GET',
      url: `/api/items/${matrix?.item?.id}/images/poster?v=${matrix?.item?.posterVersion}`,
    })
    expect(poster.statusCode).toBe(200)
    expect(poster.headers['content-type']).toBe('image/jpeg')
    expect(poster.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect([...poster.rawPayload.subarray(0, 2)]).toEqual([0xff, 0xd8])
    expect(poster.rawPayload.equals(FAKE_JPEG)).toBe(false)

    const backdrop = await app().inject({
      method: 'GET',
      url: `/api/items/${matrix?.item?.id}/images/backdrop?v=1`,
    })
    expect(backdrop.statusCode).toBe(200)
    expect(backdrop.rawPayload.equals(FAKE_JPEG)).toBe(true)
    const fetchedBefore = tmdb.state.calls.filter((url) => url.includes('backdrop603')).length
    await app().inject({ method: 'GET', url: `/api/items/${matrix?.item?.id}/images/backdrop?v=1` })
    expect(tmdb.state.calls.filter((url) => url.includes('backdrop603')).length).toBe(fetchedBefore)

    const still = await app().inject({
      method: 'GET',
      url: `/api/items/${matrix?.item?.id}/images/still`,
    })
    expect(still.statusCode).toBe(404)
  })

  it('offers every picture a movie could show, and keeps the chosen one through a refresh', async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    const id = matrix?.item?.id
    const options = shape({
      response: await asAdmin({ method: 'GET', url: `/api/items/${id}/images` }),
      guard: isItemImageOptions,
    })
    // The poster beside the files comes first and is the current one; TMDB's own poster is listed too.
    expect(options.poster.map((option) => [option.source, option.ref, option.current])).toEqual([
      ['local', join(state.media, 'The Matrix (1999)', 'poster.jpg'), true],
      ['tmdb', '/poster603.jpg', false],
      ['tmdb', '/alt603.jpg', false],
    ])
    expect(options.poster[1]).toMatchObject({ width: 2000, height: 3000, language: 'en' })
    expect(options.backdrop.map((option) => [option.ref, option.current])).toEqual([
      ['/backdrop603.jpg', true],
      ['/scene603.jpg', false],
    ])
    expect(options.backdrop[1]).toMatchObject({ width: 2000, height: 3000, language: 'en' })

    const chosen = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/items/${id}/images/poster`,
        payload: { source: 'tmdb', ref: '/alt603.jpg' },
      }),
      guard: isItemDetails,
    })
    expect(chosen.posterVersion).not.toBe(matrix?.item?.posterVersion)
    const poster = await app().inject({
      method: 'GET',
      url: `/api/items/${id}/images/poster?v=${chosen.posterVersion}`,
    })
    expect(poster.rawPayload.equals(FAKE_JPEG)).toBe(true)
    expect(tmdb.state.calls.some((url) => url.includes('/alt603.jpg'))).toBe(true)
    const local = await app().inject({ method: 'GET', url: `/api/items/${id}/images/poster/local` })
    expect(local.statusCode).toBe(200)
    expect(local.rawPayload.equals(FAKE_JPEG)).toBe(false)

    await asAdmin({ method: 'POST', url: `/api/items/${id}/refresh` })
    const after = shape({
      response: await asAdmin({ method: 'GET', url: `/api/items/${id}/images` }),
      guard: isItemImageOptions,
    })
    expect(after.poster.find((option) => option.current)?.ref).toBe('/alt603.jpg')

    const back = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/items/${id}/images/poster`,
        payload: { source: 'local' },
      }),
      guard: isItemDetails,
    })
    expect(back.posterVersion).toBe(matrix?.item?.posterVersion)

    const refused = await asAdmin({
      method: 'PUT',
      url: `/api/items/${id}/images/poster`,
      payload: { source: 'tmdb', ref: 'https://evil.example/x.jpg' },
    })
    expect(refused.statusCode).toBe(400)
  })

  it('writes metadata over TMDB’s, keeps it through a refresh, and gives it back on null', async () => {
    const heat = await byFile('Heat.mp4')
    const id = heat.item?.id
    const before = shape({
      response: await asAdmin({ method: 'GET', url: `/api/items/${id}/metadata` }),
      guard: isItemMetadataState,
    })
    expect(before).toMatchObject({
      shown: { title: 'Heat' },
      original: { title: 'Heat' },
      overridden: [],
    })

    const edited = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/items/${id}/metadata`,
        payload: { title: 'Heat (Director’s Cut)', tagline: 'A Los Angeles crime saga' },
      }),
      guard: isItemDetails,
    })
    expect(edited).toMatchObject({
      title: 'Heat (Director’s Cut)',
      tagline: 'A Los Angeles crime saga',
    })
    expect((await byFile('Heat.mp4')).item?.title).toBe('Heat (Director’s Cut)')
    const written = shape({
      response: await asAdmin({ method: 'GET', url: `/api/items/${id}/metadata` }),
      guard: isItemMetadataState,
    })
    expect(written.original.title).toBe('Heat')
    expect(written.overridden).toEqual(['title', 'tagline'])

    await asAdmin({ method: 'POST', url: `/api/items/${id}/refresh` })
    expect((await byFile('Heat.mp4')).item?.title).toBe('Heat (Director’s Cut)')

    const refused = await asAdmin({
      method: 'PUT',
      url: `/api/items/${id}/metadata`,
      payload: { title: '   ' },
    })
    expect(refused.statusCode).toBe(400)

    const back = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/items/${id}/metadata`,
        payload: { title: null, tagline: null },
      }),
      guard: isItemDetails,
    })
    expect(back.title).toBe('Heat')
    expect((await byFile('Heat.mp4')).item?.title).toBe('Heat')

    // An emptied field shows nothing, where null would bring TMDB's back.
    const emptied = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/items/${id}/metadata`,
        payload: { tagline: '', year: 0 },
      }),
      guard: isItemDetails,
    })
    expect(emptied).toMatchObject({ tagline: null, year: null })
    const empty = shape({
      response: await asAdmin({ method: 'GET', url: `/api/items/${id}/metadata` }),
      guard: isItemMetadataState,
    })
    expect(empty).toMatchObject({
      shown: { tagline: null, year: null },
      original: { tagline: 'A tagline.', year: 1995 },
    })
    expect(empty.overridden.toSorted()).toEqual(['tagline', 'year'])
    const restored = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/items/${id}/metadata`,
        payload: { tagline: null, year: null },
      }),
      guard: isItemDetails,
    })
    expect(restored).toMatchObject({ tagline: 'A tagline.', year: 1995 })
  })

  it('serves a cast photo', async () => {
    const matrix = (await list()).find((item) => item.item?.title === 'The Matrix')
    const details = shape({
      response: await app().inject({ method: 'GET', url: `/api/items/${matrix?.item?.id}` }),
      guard: isItemDetails,
    })
    const keanu = details.credits.find((credit) => credit.name === 'Keanu Reeves')
    const photo = await app().inject({
      method: 'GET',
      url: `/api/people/${keanu?.personId}/photo?v=${keanu?.photoVersion}`,
    })
    expect(photo.statusCode).toBe(200)
    const morpheus = details.credits.find((credit) => credit.name === 'Laurence Fishburne')
    expect(morpheus?.photoVersion).toBeNull()
  })

  it('searches and sorts over matched titles and years', async () => {
    const found = await list('?q=matrix')
    expect(found.map((item) => item.item?.title)).toEqual(['The Matrix'])
    const newest = await list('?sort=year-new')
    expect(newest.map((item) => item.item?.year ?? item.year)).toEqual([
      2022,
      2020,
      1999,
      1995,
      1994,
      1992,
      null,
    ])
  })

  it('reports metadata in the health check', async () => {
    const health = await app().inject({ method: 'GET', url: '/api/health' })
    const body: unknown = health.json()
    const metadata = isRecord(body) ? body.metadata : null
    expect(isMetadataHealth(metadata) && metadata).toMatchObject({
      tmdb: 'ok',
      omdb: 'ok',
      pending: 0,
      ai: 'off',
      aiRemaining: 0,
      aiPending: 0,
    })
    expect(health.body).not.toContain('test-token')
  })

  it('searches TMDB for Fix match, with candidate posters through the cache', async () => {
    const results = shape({
      response: await asAdmin({
        method: 'GET',
        url: '/api/match/search?type=movie&query=Unknown%20Thing',
      }),
      guard: isMatchCandidateList,
    })
    expect(results.map((result) => result.tmdbId)).toEqual(['11', '12'])
    const poster = await app().inject({
      method: 'GET',
      url: `/api/images/poster${results[0]?.poster}`,
    })
    expect(poster.statusCode).toBe(200)
    const statusOf = async (url: string) => (await app().inject({ method: 'GET', url })).statusCode
    expect(await statusOf('/api/images/backdrop/backdrop11.jpg')).toBe(200)
    expect(await statusOf('/api/images/logo/logo11.png')).toBe(200)
    // A still is never offered, so it is no picture to serve, and nor is a path off TMDB's CDN.
    expect(await statusOf('/api/images/still/still11.jpg')).toBe(404)
    expect(await statusOf('/api/images/poster/..%2Fsecret.jpg')).toBe(404)
  })

  it('keeps a Fix match through a rename', async () => {
    const unknown = await byFile('Unknown Thing (2020).mp4')
    const fixed = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/media/${unknown.id}/match`,
        payload: { tmdbId: '12' },
      }),
      guard: isMediaItem,
    })
    expect(fixed).toMatchObject({ match: 'manual', item: { title: 'Unknown Thing Two' } })

    const folder = join(state.media, 'Unknown Thing (2020)')
    await rename(
      join(folder, 'Unknown Thing (2020).mp4'),
      join(folder, 'Unknown.Thing.2020.720p.mp4'),
    )
    const moviesFetched = tmdb.state.calls.filter((url) => url.includes('/movie/12')).length
    await rescan()
    expect(await byFile('Unknown.Thing.2020.720p.mp4')).toMatchObject({
      match: 'manual',
      item: { title: 'Unknown Thing Two' },
    })
    expect(tmdb.state.calls.filter((url) => url.includes('/movie/12')).length).toBe(moviesFetched)
  })

  it('leaves a file unmatched when told it is not a movie', async () => {
    const pulp = await byFile('Pulp.Fiction.1994.1080p.BluRay.x264.mp4')
    const fixed = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/media/${pulp.id}/match`,
        payload: { tmdbId: null },
      }),
      guard: isMediaItem,
    })
    expect(fixed).toMatchObject({ match: 'unmatched', item: null })
    await rescan()
    expect(await byFile('Pulp.Fiction.1994.1080p.BluRay.x264.mp4')).toMatchObject({
      match: 'unmatched',
    })
  })

  it('refuses a Fix match that is not a TMDB id', async () => {
    const heat = await byFile('Heat.mp4')
    const response = await asAdmin({
      method: 'PUT',
      url: `/api/media/${heat.id}/match`,
      payload: { tmdbId: '../1' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('refreshes an item from TMDB', async () => {
    const heat = await byFile('Heat.mp4')
    const response = await asAdmin({ method: 'POST', url: `/api/items/${heat.item?.id}/refresh` })
    expect(response.statusCode).toBe(200)
    expect(shape({ response, guard: isItemDetails }).title).toBe('Heat')
  })

  it('matches again when the type changes to Anime movies, keeping what it found and every Fix match', async () => {
    const matches = async () =>
      (await list()).map((item) => [item.fileName, item.match, item.item?.title ?? null])
    const before = await matches()
    const asked = tmdb.state.calls.length
    expect((await setKind('animeMovies')).settings).toMatchObject({ kind: 'animeMovies' })
    await settle()
    // Nothing here is animation, so every search falls through to the same pick.
    expect(await matches()).toEqual(before)
    expect((await list()).find((item) => item.title === 'Unknown Thing')).toMatchObject({
      match: 'manual',
      item: { title: 'Unknown Thing Two' },
    })
    const searched = tmdb.state.calls.length
    expect(searched).toBeGreaterThan(asked)
    await setKind('movies')
    await settle()
    expect(await matches()).toEqual(before)
    expect(tmdb.state.calls.length).toBeGreaterThan(searched)
  })

  it('matches again when the type changes, and goes back to file names for Other', async () => {
    await setKind('other')
    await settle()
    const other = await list()
    expect(other.every((item) => item.match === 'off' && item.item === null)).toBe(true)
    expect(other.map((item) => item.title)).toContain('Pulp Fiction 1994 1080p BluRay x264')

    await setKind('movies')
    await settle()
    const movies = await list()
    expect(movies.find((item) => item.title === 'Heat')).toMatchObject({ match: 'matched' })
    expect(movies.find((item) => item.title === 'Unknown Thing')).toMatchObject({
      match: 'manual',
      item: { title: 'Unknown Thing Two' },
    })
  })

  it('leaves files pending while TMDB is away, and matches them once it is back', async () => {
    tmdb.state.down = true
    await encodeClip({ path: join(state.media, 'Late', 'The Matrix (1999).mp4'), seconds: 1 })
    await rescan()
    tmdb.state.down = false
    expect(await byFile('The Matrix (1999).mp4')).toMatchObject({ match: 'pending' })
    await rescan()
    expect(await byFile('The Matrix (1999).mp4')).toMatchObject({
      match: 'matched',
      item: { title: 'The Matrix' },
    })
  })

  it('matches again a file the running pass has already given up on', async () => {
    const lost = join(state.media, 'Lost Signal (2019)', 'Lost Signal (2019).mp4')
    await encodeClip({ path: lost, seconds: 1 })
    await rescan()
    expect(await byFile('Lost Signal (2019).mp4')).toMatchObject({ match: 'unmatched' })

    // A pass busy with another file gives up on Lost Signal again while it runs.
    const letGo = tmdb.hold('Slow Burn')
    await encodeClip({ path: join(state.media, 'Slow Burn (2018).mp4'), seconds: 1 })
    app().get(MatchFiles).retryUnmatched(state.library)
    await asAdmin({ method: 'POST', url: `/api/libraries/${state.library}/scan` })
    await vi.waitFor(
      async () =>
        expect(await byFile('Lost Signal (2019).mp4')).toMatchObject({ match: 'unmatched' }),
      { timeout: 5000 },
    )

    // TMDB lists it now, and Match again comes in before that pass ends.
    tmdb.state.movies.push({ id: 404, title: 'Lost Signal', released: '2019-04-04' })
    const library = shape({
      response: await asAdmin({ method: 'POST', url: `/api/libraries/${state.library}/match` }),
      guard: isLibrary,
    })
    expect(library.unmatchedCount).toBe(0)
    letGo()
    await settle()
    expect(await byFile('Lost Signal (2019).mp4')).toMatchObject({
      match: 'matched',
      item: { title: 'Lost Signal' },
    })
  })

  it('clears up a movie once its files are gone', async () => {
    const heat = await byFile('Heat.mp4')
    await rm(join(state.media, 'Heat (1995) {tmdb-949}'), { recursive: true })
    await rescan()
    const gone = await app().inject({ method: 'GET', url: `/api/items/${heat.item?.id}` })
    expect(gone.statusCode).toBe(404)
  })
})
