import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type MediaItem,
  isItemDetails,
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
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = {
  statusCode: number
  rawPayload: Buffer
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

describe('matching by library type', () => {
  // The live-action series is listed first, as TMDB lists the more popular one.
  const tmdb = fakeTmdb({
    movies: [{ id: 603, title: 'The Matrix', released: '1999-03-31' }],
    shows: [
      {
        id: 90660,
        title: 'Cowboy Bebop',
        first: '2021-11-19',
        genreIds: [10759, 18],
        language: 'en',
        countries: ['US'],
        seasons: { 1: [{ number: 1, title: 'Cowboy Gospel', aired: '2021-11-19' }] },
      },
      {
        id: 30991,
        title: 'Cowboy Bebop',
        first: '1998-04-03',
        genreIds: [16, 10759],
        language: 'ja',
        countries: ['JP'],
        seasons: { 1: [{ number: 1, title: 'Asteroid Blues', aired: '1998-10-24' }] },
      },
    ],
  })
  const state: {
    root: string
    tv: string
    films: string
    data: string
    app: NestFastifyApplication | null
    library: number
    filmLibrary: number
  } = { root: '', tv: '', films: '', data: '', app: null, library: 0, filmLibrary: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(ScannerService).whenIdle(state.filmLibrary)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  /** Saves a library's type as Edit does, and waits for the matching it sets off. */
  const saveKind = async ({
    id,
    name,
    path,
    kind,
  }: {
    id: number
    name: string
    path: string
    kind: string
  }): Promise<void> => {
    const response = await app().inject({
      method: 'PUT',
      url: `/api/libraries/${id}`,
      payload: { name, paths: [path], settings: { kind } },
    })
    expect(response.statusCode).toBe(200)
    await settle()
  }
  const setKind = (kind: string) =>
    saveKind({ id: state.library, name: 'TV', path: state.tv, kind })
  const setFilmKind = (kind: string) =>
    saveKind({ id: state.filmLibrary, name: 'Films', path: state.films, kind })
  const films = async (): Promise<MediaItem[]> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.filmLibrary}/media`,
      }),
      guard: isMediaList,
    })
  const showYears = async (): Promise<Array<number | null>> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/shows`,
      }),
      guard: isShowListing,
    }).shows.map((entry) => entry.show.year)

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-types-'))
    state.tv = join(state.root, 'TV')
    state.films = join(state.root, 'Films')
    state.data = join(state.root, 'data')
    const matrix = join(state.films, 'The Matrix (1999)')
    await Promise.all([
      encodeClip({
        path: join(
          state.tv,
          'Cowboy Bebop',
          'Season 1',
          'Cowboy Bebop - S01E01 - Asteroid Blues.mp4',
        ),
        seconds: 1,
      }),
      encodeClip({ path: join(matrix, 'The Matrix (1999) Bluray-1080p.mp4'), seconds: 1 }),
      encodeClip({
        path: join(matrix, 'The Matrix (1999) Remux-2160p.mp4'),
        seconds: 1,
        size: '640x360',
      }),
    ])
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        hwAccel: 'none',
        dataDir: state.data,
        webDir: null,
        browseRoot: state.root,
        scanOnStart: false,
        rescanIntervalMinutes: 0,
        tmdbApiToken: 'test-token',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.library = shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'TV', paths: [state.tv], settings: { kind: 'shows' } },
      }),
      guard: isLibrary,
    }).id
    state.filmLibrary = shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'Films', paths: [state.films], settings: { kind: 'movies' } },
      }),
      guard: isLibrary,
    }).id
    await settle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('matches the more popular series in a TV library', async () => {
    expect(await showYears()).toEqual([2021])
  })

  it('matches the anime again once the library is Anime shows, and the series once it is TV again', async () => {
    await setKind('animeShows')
    expect(await showYears()).toEqual([1998])
    await setKind('shows')
    expect(await showYears()).toEqual([2021])
  })

  it("lists the results a library's type prefers first in Fix match", async () => {
    const order = async (query: string): Promise<string[]> =>
      shape({
        response: await app().inject({
          method: 'GET',
          url: `/api/match/search?type=show&query=Cowboy%20Bebop${query}`,
        }),
        guard: isMatchCandidateList,
      }).map((each) => each.tmdbId)
    await setKind('animeShows')
    expect(await order(`&libraryId=${state.library}`)).toEqual(['30991', '90660'])
    expect(await order('')).toEqual(['90660', '30991'])
    // A library removed while the dialog was open lists TMDB's order.
    expect(await order('&libraryId=9999')).toEqual(['90660', '30991'])
    await setKind('shows')
    expect(await order(`&libraryId=${state.library}`)).toEqual(['90660', '30991'])
  })

  it('refuses a library id that is not one', async () => {
    const response = await app().inject({
      method: 'GET',
      url: '/api/match/search?type=show&query=Cowboy%20Bebop&libraryId=abc',
    })
    expect(response.statusCode).toBe(400)
  })

  it('keeps a split movie split when Movies becomes Anime movies, searching TMDB again', async () => {
    const cards = async () =>
      (await films()).map((card) => [card.fileName, card.variant, card.item?.title ?? null])
    const [card] = await films()
    const split = await app().inject({
      method: 'POST',
      url: `/api/libraries/${state.filmLibrary}/duplicates/split`,
      payload: { mediaId: card?.id, how: 'apart' },
    })
    expect(split.statusCode).toBe(200)
    const apart = await cards()
    expect(apart).toHaveLength(2)
    expect(apart.every(([, variant]) => variant != null)).toBe(true)
    const asked = tmdb.state.calls.length
    await setFilmKind('animeMovies')
    expect(await cards()).toEqual(apart)
    expect(tmdb.state.calls.length).toBeGreaterThan(asked)
    await setFilmKind('movies')
    expect(await cards()).toEqual(apart)
  })

  it('keeps the movie, its edits and its matches when Movies becomes Anime movies while TMDB is away', async () => {
    await setFilmKind('movies')
    const [card] = await films()
    const itemId = card?.item?.id
    const movie = async () =>
      shape({
        response: await app().inject({ method: 'GET', url: `/api/items/${itemId}` }),
        guard: isItemDetails,
      })
    const edited = await app().inject({
      method: 'PUT',
      url: `/api/items/${itemId}/metadata`,
      payload: { title: 'The Matrix (Edited)' },
    })
    expect(edited.statusCode).toBe(200)
    tmdb.state.down = true
    await setFilmKind('animeMovies')
    tmdb.state.down = false
    const kept = await movie()
    expect(kept.title).toBe('The Matrix (Edited)')
    expect(kept.versions.map((version) => [version.match, version.item?.id])).toEqual([
      ['matched', itemId],
      ['matched', itemId],
    ])
    await setFilmKind('movies')
    expect((await movie()).title).toBe('The Matrix (Edited)')
  })

  it('keeps a show while TMDB is away during a change to Movies, and finds it again once it is back', async () => {
    const listing = async () =>
      shape({
        response: await app().inject({
          method: 'GET',
          url: `/api/libraries/${state.library}/shows`,
        }),
        guard: isShowListing,
      }).shows.map((entry) => ({ id: entry.show.id, title: entry.show.title }))
    const [show] = await listing()
    const showId = show?.id
    await app().inject({
      method: 'PUT',
      url: `/api/items/${showId}/metadata`,
      payload: { title: 'Cowboy Bebop (Edited)' },
    })
    tmdb.state.down = true
    await setKind('movies')
    tmdb.state.down = false
    const kept = await app().inject({ method: 'GET', url: `/api/items/${showId}` })
    expect(shape({ response: kept, guard: isItemDetails }).title).toBe('Cowboy Bebop (Edited)')
    await setKind('shows')
    expect(await listing()).toEqual([{ id: showId, title: 'Cowboy Bebop (Edited)' }])
    await app().inject({
      method: 'PUT',
      url: `/api/items/${showId}/metadata`,
      payload: { title: null },
    })
  })
})
