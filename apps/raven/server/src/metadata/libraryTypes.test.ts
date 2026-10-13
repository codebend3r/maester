import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isLibrary, isShowListing } from '@raven/core'
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
    movies: [],
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
    data: string
    app: NestFastifyApplication | null
    library: number
  } = { root: '', tv: '', data: '', app: null, library: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const setKind = async (kind: string): Promise<void> => {
    await app().inject({
      method: 'PUT',
      url: `/api/libraries/${state.library}`,
      payload: { name: 'TV', paths: [state.tv], settings: { kind } },
    })
    await settle()
  }
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
    state.data = join(state.root, 'data')
    await encodeClip({
      path: join(
        state.tv,
        'Cowboy Bebop',
        'Season 1',
        'Cowboy Bebop - S01E01 - Asteroid Blues.mp4',
      ),
      seconds: 1,
    })
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
})
