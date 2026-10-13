import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type Library,
  type MediaItem,
  type ShowListing,
  isLibrary,
  isMediaList,
  isShowListing,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
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

describe('letter and group folders', () => {
  const tmdb = fakeTmdb({
    movies: [
      { id: 348, title: 'Alien', released: '1979-05-25' },
      { id: 949, title: 'Heat', released: '1995-12-15' },
    ],
    shows: [
      {
        id: 83867,
        title: 'Andor',
        first: '2022-09-21',
        seasons: {
          1: [{ number: 1, title: 'Kassa', aired: '2022-09-21' }],
          2: [{ number: 1, title: 'One Year Later', aired: '2025-04-22' }],
        },
      },
      {
        id: 114461,
        title: 'Ahsoka',
        first: '2023-08-22',
        seasons: { 1: [{ number: 1, title: 'Master and Apprentice', aired: '2023-08-22' }] },
      },
      {
        id: 46298,
        title: 'K',
        first: '2012-10-05',
        seasons: { 1: [{ number: 1, title: 'Kitten', aired: '2012-10-05' }] },
      },
      {
        id: 250307,
        title: 'Cupertino',
        first: '2026-01-10',
        seasons: { 1: [{ number: 1, title: 'Pilot', aired: '2026-01-10' }] },
      },
    ],
  })
  const state: {
    root: string
    tv: string
    movies: string
    data: string
    app: NestFastifyApplication | null
    shows: number
    moviesLibrary: number
  } = { root: '', tv: '', movies: '', data: '', app: null, shows: 0, moviesLibrary: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.shows)
    await app().get(ScannerService).whenIdle(state.moviesLibrary)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const showsOf = async (id: number): Promise<ShowListing> =>
    shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${id}/shows` }),
      guard: isShowListing,
    })
  const mediaOf = async (id: number): Promise<MediaItem[]> =>
    shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${id}/media` }),
      guard: isMediaList,
    })
  const libraryOf = async (id: number): Promise<Library> =>
    shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${id}` }),
      guard: isLibrary,
    })
  const putLayout = async (folderLayout: 'auto' | 'flat') => {
    await app().inject({
      method: 'PUT',
      url: `/api/libraries/${state.shows}`,
      payload: { name: 'TV', paths: [state.tv], settings: { kind: 'shows', folderLayout } },
    })
  }
  const setLayout = async (folderLayout: 'auto' | 'flat') => {
    await putLayout(folderLayout)
    await settle()
  }
  const kassa = async (): Promise<MediaItem | undefined> =>
    (await mediaOf(state.shows)).find((item) => item.fileName === 'Andor - S01E01 - Kassa.mp4')
  const showTitles = async (): Promise<string[]> =>
    (await showsOf(state.shows)).shows.map((entry) => entry.show.title)
  const createLibrary = async ({
    name,
    path,
    kind,
  }: {
    name: string
    path: string
    kind: 'shows' | 'movies'
  }): Promise<number> =>
    shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name, paths: [path], settings: { kind } },
      }),
      guard: isLibrary,
    }).id

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-letters-'))
    state.tv = join(state.root, 'TV')
    state.movies = join(state.root, 'Movies')
    state.data = join(state.root, 'data')
    await Promise.all([
      encodeClip({
        path: join(state.tv, 'A', 'Andor', 'Season 1', 'Andor - S01E01 - Kassa.mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(
          state.tv,
          'A',
          'Ahsoka',
          'Season 1',
          'Ahsoka - S01E01 - Master and Apprentice.mp4',
        ),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.tv, 'K', 'K', 'Season 1', 'K - S01E01 - Kitten.mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.tv, 'Requests', 'Cupertino', 'Season 1', 'Cupertino - S01E01 - Pilot.mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.movies, 'A', 'Alien (1979)', 'Alien (1979).mp4'),
        seconds: 1,
      }),
      encodeClip({ path: join(state.movies, 'H', 'Heat (1995).mp4'), seconds: 1 }),
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
    state.shows = await createLibrary({ name: 'TV', path: state.tv, kind: 'shows' })
    state.moviesLibrary = await createLibrary({
      name: 'Movies',
      path: state.movies,
      kind: 'movies',
    })
    await settle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('matches each show under a letter or group folder as its own show', async () => {
    const listing = await showsOf(state.shows)
    expect(listing.shows.map((entry) => entry.show.title)).toEqual([
      'Ahsoka',
      'Andor',
      'Cupertino',
      'K',
    ])
    expect(listing.unmatched).toEqual([])
  })

  it('files each episode under its show, not its letter', async () => {
    const andor = (await mediaOf(state.shows)).find(
      (item) => item.fileName === 'Andor - S01E01 - Kassa.mp4',
    )
    expect(andor?.folder).toBe('Andor/Season 1')
  })

  it('says the TV path has letter folders, and how many group folders', async () => {
    const library = await libraryOf(state.shows)
    expect(library.layouts).toEqual([{ path: state.tv, layout: 'lettered', groups: 3 }])
  })

  it('reads movies under letter folders, a loose one included', async () => {
    const items = await mediaOf(state.moviesLibrary)
    expect(items.map((item) => [item.fileName, item.folder, item.match]).toSorted()).toEqual([
      ['Alien (1979).mp4', 'Alien (1979)', 'matched'],
      ['Heat (1995).mp4', '', 'matched'],
    ])
  })

  it('files a new episode the watcher finds inside a letter folder under its show', async () => {
    const path = join(state.tv, 'A', 'Andor', 'Season 2', 'Andor - S02E01 - One Year Later.mp4')
    await encodeClip({ path, seconds: 1 })
    app()
      .get(ScannerService)
      .refresh({ libraryId: state.shows, places: [path] })
    await settle()
    const added = (await mediaOf(state.shows)).find(
      (item) => item.fileName === 'Andor - S02E01 - One Year Later.mp4',
    )
    expect(added?.folder).toBe('Andor/Season 2')
    expect((await showsOf(state.shows)).shows.map((entry) => entry.show.title)).toEqual([
      'Ahsoka',
      'Andor',
      'Cupertino',
      'K',
    ])
  })

  it('reads every top folder as a title when set to flat, and letter folders again when set back', async () => {
    await setLayout('flat')
    expect((await kassa())?.folder).toBe('A/Andor/Season 1')
    expect((await libraryOf(state.shows)).layouts).toEqual([
      { path: state.tv, layout: 'flat', groups: 0 },
    ])
    await setLayout('auto')
    expect(await showTitles()).toEqual(['Ahsoka', 'Andor', 'Cupertino', 'K'])
    expect((await libraryOf(state.shows)).layouts).toEqual([
      { path: state.tv, layout: 'lettered', groups: 3 },
    ])
  })

  it('reads files again for a layout change made while a relayout still runs', async () => {
    await app().get(MetadataService).whenIdle()
    const gate = { isRunning: false, open: (): void => undefined }
    // Stands in for a relayout of this library still running when the change comes.
    app()
      .get(MetadataService)
      .schedule({
        key: `layout:${state.shows}`,
        task: () =>
          new Promise<void>((resolve) => {
            gate.isRunning = true
            gate.open = resolve
          }),
      })
    expect(gate.isRunning).toBe(true)
    await putLayout('flat')
    gate.open()
    await settle()
    expect((await kassa())?.folder).toBe('A/Andor/Season 1')
    await setLayout('auto')
    expect(await showTitles()).toEqual(['Ahsoka', 'Andor', 'Cupertino', 'K'])
  })

  it('reads a file still filed under its letter again on boot', async () => {
    app()
      .get(DatabaseService)
      .db.prepare('UPDATE media SET folder = ? WHERE library_id = ? AND file_name = ?')
      .run('A/Andor/Season 1', state.shows, 'Andor - S01E01 - Kassa.mp4')
    expect((await kassa())?.folder).toBe('A/Andor/Season 1')
    app().get(MetadataService).onApplicationBootstrap()
    await settle()
    expect((await kassa())?.folder).toBe('Andor/Season 1')
    expect(await showTitles()).toEqual(['Ahsoka', 'Andor', 'Cupertino', 'K'])
  })

  // Last: it changes what Andor is.
  it('fixes the match of one show under a letter folder without touching its neighbours', async () => {
    const before = await showsOf(state.shows)
    const andor = before.shows.find((entry) => entry.show.title === 'Andor')
    await app().inject({
      method: 'PUT',
      url: `/api/items/${andor?.show.id}/match`,
      payload: { tmdbId: '114461' },
    })
    await settle()
    const states = (await mediaOf(state.shows))
      .map((item) => [item.fileName, item.match])
      .toSorted()
    expect(states).toEqual([
      ['Ahsoka - S01E01 - Master and Apprentice.mp4', 'matched'],
      ['Andor - S01E01 - Kassa.mp4', 'manual'],
      ['Andor - S02E01 - One Year Later.mp4', 'manual'],
      ['Cupertino - S01E01 - Pilot.mp4', 'matched'],
      ['K - S01E01 - Kitten.mp4', 'matched'],
    ])
  })
})
