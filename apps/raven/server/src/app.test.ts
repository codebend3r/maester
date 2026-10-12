import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  LIBRARY_KINDS,
  type LibraryInput,
  type LibrarySettings,
  type MediaItem,
  isRecord,
  isScanning,
  parseServerEvent,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { CONTROLLERS } from '@/appModule'
import { type ServerConfig, readServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { LOCKED_SCAN_ERROR } from '@/libraries/librariesController'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { routeMarks } from '@/lock/lockGuard'
import type { Privacy } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { BLANK_ITEM } from '@/metadata/tmdbClient'
import { ScannerService } from '@/scanner/scannerService'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

const isRouteMethod = (value: string): value is (typeof ROUTE_METHODS)[number] =>
  ROUTE_METHODS.some((method) => method === value)

/** A watcher that never fires, for tests that scan by hand. */
const NOT_WATCHING = { watchFolder: () => ({ close: () => undefined }) }

/** Resolves with `read()` once `check` holds for it, polling, or fails after `ms`. */
const eventually = async <T>({
  read,
  check,
  ms = 10_000,
}: {
  read: () => Promise<T>
  check: (value: T) => boolean
  ms?: number
}): Promise<T> => {
  const until = Date.now() + ms
  const poll = async (): Promise<T> => {
    const value = await read()
    if (check(value)) return value
    if (Date.now() > until) throw new Error(`timed out waiting: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return poll()
  }
  return poll()
}

/** Every key anywhere in a parsed JSON body. */
const keysOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, field]) => [key, ...keysOf(field)])
}

/** Strong enough for the admin lock, so the tests' servers can turn it off. */
const ADMIN_PASSWORD = 'Raven-Admin-2026'

/** The cookie a response sets, as a browser sends it back: its name and value, no attributes. */
const cookieSet = (response: { headers: Record<string, unknown> }): string => {
  const header = response.headers['set-cookie']
  return typeof header === 'string' ? (header.split(';')[0] ?? '') : ''
}

/** Turns the admin lock off with the password, as Settings does, for the cookie a browser keeps. */
const adminCookie = async (app: NestFastifyApplication): Promise<string> =>
  cookieSet(
    await app.inject({
      method: 'POST',
      url: '/api/admin/unlock',
      payload: { password: ADMIN_PASSWORD },
    }),
  )

/** Every cookie given, in one Cookie header. */
const cookies = (...given: (string | undefined)[]): string =>
  given.filter((cookie) => !!cookie).join('; ')

const testConfig = ({
  dataDir,
  mediaDir,
  webDir = null,
}: {
  dataDir: string
  mediaDir: string
  webDir?: string | null
}): ServerConfig => ({
  ...readServerConfig({}),
  hwAccel: 'none',
  dataDir,
  webDir,
  browseRoot: mediaDir,
  scanOnStart: false,
  rescanIntervalMinutes: 0,
  adminPassword: ADMIN_PASSWORD,
})

/** As a browser with the admin lock off, so every route answers; `the admin lock` covers it on. */
describe('the media server', () => {
  const state: {
    root: string
    media: string
    data: string
    admin: string
    app: NestFastifyApplication | null
  } = {
    root: '',
    media: '',
    data: '',
    admin: '',
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const settle = async (libraryId: number) => {
    await app().get(ScannerService).whenIdle(libraryId)
    await app().get(ThumbnailService).whenIdle()
  }
  const listMedia = (libraryId: number): Promise<MediaItem[]> => api().listMedia({ libraryId })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-app-'))
    state.media = join(state.root, 'media')
    state.data = join(state.root, 'data')
    await encodeClip({ path: join(state.media, 'Movies', 'Big.Buck.Test.2008.mp4') })
    await encodeClip({
      path: join(state.media, 'TV', 'Show', 'Season 1', 'Show - S01E01.mkv'),
      audio: 'ac3',
    })
    await mkdir(join(state.media, 'Movies', '.hidden'), { recursive: true })
    await writeFile(join(state.media, 'Movies', 'notes.txt'), 'not a video')
    state.app = await createApp({
      config: testConfig({ dataDir: state.data, mediaDir: state.media }),
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('rejects a library without a name or folder', async () => {
    await expect(api().createLibrary({ name: ' ', paths: [] })).rejects.toMatchObject({
      status: 400,
      message: 'Give the library a name. Add at least one folder.',
    })
  })

  describe('with a library', () => {
    const library = { id: 0 }
    const paths = () => [join(state.media, 'Movies'), join(state.media, 'TV')]

    beforeAll(async () => {
      const created = await api().createLibrary({ name: 'Everything', paths: paths() })
      expect(isScanning(created.scan)).toBe(true)
      library.id = created.id
      await settle(created.id)
    })

    it('indexes every video with its probe data', async () => {
      const items = await listMedia(library.id)
      expect(items.map((item) => item.title)).toEqual(['Big Buck Test 2008', 'Show - S01E01'])
      const [movie, episode] = items
      expect(movie).toMatchObject({
        container: 'mp4',
        folder: '',
        videoCodec: 'h264',
        videoBitDepth: 8,
        audioCodec: 'aac',
        width: 320,
        height: 240,
        thumbnail: 'ready',
      })
      expect(movie?.duration).toBeCloseTo(6, 0)
      expect(episode).toMatchObject({
        container: 'mkv',
        folder: join('Show', 'Season 1'),
        audioCodec: 'ac3',
      })
    })

    it('never sends a client a file path from anything that answers with videos', async () => {
      const [movie] = await listMedia(library.id)
      const id = movie?.id ?? -1
      await api().recordPlay(id)
      await api().setFavourite({ id, favourite: true })
      const answers = await Promise.all(
        [
          { method: 'GET', url: `/api/libraries/${library.id}/media` },
          { method: 'GET', url: `/api/libraries/${library.id}/shows` },
          { method: 'GET', url: `/api/libraries/${library.id}/history` },
          { method: 'GET', url: `/api/media/${id}` },
          { method: 'PUT', url: `/api/media/${id}/favourite`, payload: { favourite: true } },
          { method: 'GET', url: '/api/favourites' },
          { method: 'GET', url: '/api/home' },
        ].map(async ({ method, url, payload }) => {
          const response = await app().inject({
            method: isRouteMethod(method) ? method : 'GET',
            url,
            payload,
          })
          expect(response.statusCode, url).toBe(200)
          return { url, body: response.body, keys: keysOf(response.json()) }
        }),
      )
      await api().setFavourite({ id, favourite: false })
      expect(answers.filter(({ body }) => body.includes(state.media))).toEqual([])
      expect(answers.filter(({ keys }) => keys.includes('path'))).toEqual([])
      // Every answer but the shows of a library that has none carried a video to look in.
      expect(
        answers.filter(({ keys }) => !keys.includes('fileName')).map(({ url }) => url),
      ).toEqual([`/api/libraries/${library.id}/shows`])
    })

    it('pictures a library by its newest video, here by its thumbnail as it matched nothing', async () => {
      const [newest] = await api().listMedia({ libraryId: library.id, sort: 'added' })
      const backdrop = { type: 'thumbnail', id: newest?.id, version: newest?.thumbnailVersion }
      expect((await api().getLibrary(library.id)).backdrop).toEqual(backdrop)
      const listed = await api().listLibraries()
      expect(listed.find((entry) => entry.id === library.id)?.backdrop).toEqual(backdrop)
    })

    it("lists a library's own videos in progress and favourites, and no sagas or misses in Other", async () => {
      const [movie] = await listMedia(library.id)
      const id = movie?.id ?? -1
      await api().saveProgress({ id, position: 3 })
      await api().setFavourite({ id, favourite: true })
      try {
        const inProgress = await api().listInProgress(library.id)
        expect(inProgress.map(({ media, poster }) => [media.id, media.position, poster])).toEqual([
          [id, 3, null],
        ])
        const favourites = await api().listLibraryFavourites(library.id)
        expect(favourites.map(({ media }) => media.id)).toEqual([id])
      } finally {
        await api().saveProgress({ id, position: 0 })
        await api().setFavourite({ id, favourite: false })
      }
      expect(await api().listInProgress(library.id)).toEqual([])
      expect(await api().listLibraryFavourites(library.id)).toEqual([])
      expect(await api().listSagas(library.id)).toEqual([])
      expect(await api().listUnmatched(library.id)).toEqual([])
    })

    it('will not lock a library while the server has no PIN', async () => {
      await expect(
        api().createLibrary({ name: 'Private', paths: [state.media], settings: { locked: true } }),
      ).rejects.toMatchObject({
        status: 400,
        message: "Set LIBRARY_PIN in raven's .env to lock a library.",
      })
    })

    it('keeps a locked library shut when the server has no PIN to open it', async () => {
      const libraries = app().get(LibrariesRepository)
      const input = { name: 'Everything', paths: paths() }
      libraries.update({ id: library.id, input: { ...input, settings: { locked: true } } })
      const listing = api()
        .listMedia({ libraryId: library.id })
        .catch((error: unknown) => error)
      const unlocking = api()
        .unlock('')
        .catch((error: unknown) => error)
      const [listed, unlocked] = await Promise.all([listing, unlocking])
      libraries.update({ id: library.id, input: { ...input, settings: { locked: false } } })
      expect(listed).toMatchObject({ status: 423 })
      expect(unlocked).toMatchObject({ status: 503 })
    })

    it("tells a client where a video's file lives when it asks", async () => {
      const [movie] = await listMedia(library.id)
      const location = await api().getMediaLocation(movie?.id ?? -1)
      expect(location.path).toBe(join(state.media, 'Movies', 'Big.Buck.Test.2008.mp4'))
      await expect(api().getMediaLocation(999_999)).rejects.toMatchObject({ status: 404 })
    })

    it('reports the scan and item count on the library', async () => {
      const libraries = await api().listLibraries()
      expect(libraries).toHaveLength(1)
      expect(libraries[0]).toMatchObject({
        itemCount: 2,
        scan: { state: 'idle', found: 2, processed: 2, error: null },
      })
    })

    it('searches and sorts', async () => {
      const found = await api().listMedia({
        libraryId: library.id,
        search: 's01e01',
        sort: 'added',
      })
      expect(found.map((item) => item.title)).toEqual(['Show - S01E01'])
    })

    it('serves a JPEG thumbnail that caches forever when versioned', async () => {
      const [movie] = await listMedia(library.id)
      const url = movie ? api().thumbnailUrl(movie) : null
      const response = await app().inject({ method: 'GET', url: url ?? '' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/jpeg')
      expect(response.headers['cache-control']).toContain('immutable')
      expect([...response.rawPayload.subarray(0, 2)]).toEqual([0xff, 0xd8])
    })

    describe('direct play', () => {
      it('serves a byte range', async () => {
        const [movie] = await listMedia(library.id)
        const response = await app().inject({
          method: 'GET',
          url: api().fileUrl(movie?.id ?? -1),
          headers: { range: 'bytes=0-99' },
        })
        expect(response.statusCode).toBe(206)
        expect(response.headers['content-type']).toBe('video/mp4')
        expect(response.headers['accept-ranges']).toBe('bytes')
        expect(response.headers['content-range']).toBe(`bytes 0-99/${movie?.size}`)
        expect(response.rawPayload).toHaveLength(100)
        const onDisk = await readFile(join(state.media, 'Movies', 'Big.Buck.Test.2008.mp4'))
        expect(response.rawPayload.equals(onDisk.subarray(0, 100))).toBe(true)
      })

      it('serves the whole file without a range', async () => {
        const [, episode] = await listMedia(library.id)
        const response = await app().inject({
          method: 'GET',
          url: api().fileUrl(episode?.id ?? -1),
        })
        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toBe('video/x-matroska')
        expect(response.rawPayload).toHaveLength(episode?.size ?? -1)
      })

      it('answers 416 for a range past the end', async () => {
        const [movie] = await listMedia(library.id)
        const response = await app().inject({
          method: 'GET',
          url: api().fileUrl(movie?.id ?? -1),
          headers: { range: `bytes=${(movie?.size ?? 0) + 10}-` },
        })
        expect(response.statusCode).toBe(416)
        expect(response.headers['content-range']).toBe(`bytes */${movie?.size}`)
      })
    })

    it('remembers where playback stopped', async () => {
      const [movie] = await listMedia(library.id)
      const id = movie?.id ?? -1
      await api().saveProgress({ id, position: 3.5 })
      expect((await api().getMedia(id)).position).toBe(3.5)

      // Not a body the client can send, so sent by hand.
      const bad = await app().inject({
        method: 'PUT',
        url: `/api/media/${id}/progress`,
        payload: { position: 'soon' },
      })
      expect(bad.statusCode).toBe(400)
      await expect(api().saveProgress({ id: 999_999, position: 1 })).rejects.toMatchObject({
        status: 404,
      })
    })

    describe('settings', () => {
      const putLibrary = (settings: Partial<LibrarySettings>) =>
        api().updateLibrary({
          id: library.id,
          input: { name: 'Everything', paths: paths(), settings },
        })
      const positionOf = async (id: number): Promise<number> => (await api().getMedia(id)).position

      it('starts a library with progress saved, pinned, watched at 90%, and of no particular type', async () => {
        expect((await api().getLibrary(library.id)).settings).toEqual({
          saveProgress: true,
          pinned: true,
          sort: 'title',
          view: 'grid',
          groupBy: 'resolution',
          watchedPercent: 90,
          kind: 'other',
          ratingsSource: 'tmdb',
          autoRefresh: true,
          locked: false,
        })
      })

      it('changes what type of library it is after it was made, keeping a view and grouping the type can show', async () => {
        expect(
          (await putLibrary({ kind: 'movies', view: 'grouped', groupBy: 'match' })).settings,
        ).toMatchObject({ kind: 'movies', view: 'grouped', groupBy: 'match' })
        expect((await putLibrary({ kind: 'shows' })).settings).toMatchObject({
          kind: 'shows',
          view: 'grid',
          groupBy: 'match',
        })
        expect((await api().getLibrary(library.id)).settings.kind).toBe('shows')
        expect((await putLibrary({ kind: 'other' })).settings).toMatchObject({
          kind: 'other',
          view: 'grid',
          groupBy: 'resolution',
        })
      })

      it('never keeps a sort, view or grouping its type cannot show, whatever was sent', async () => {
        expect(
          (await putLibrary({ kind: 'shows', sort: 'largest', view: 'grouped' })).settings,
        ).toMatchObject({ kind: 'shows', sort: 'title', view: 'grid' })
        expect(
          (await putLibrary({ groupBy: 'match', sort: 'rating-high' })).settings,
        ).toMatchObject({ kind: 'shows', groupBy: 'match', sort: 'rating-high' })
        expect((await putLibrary({ kind: 'other' })).settings).toMatchObject({
          kind: 'other',
          sort: 'title',
          groupBy: 'resolution',
        })
      })

      it('reads a stored value its type cannot show as its type’s own', async () => {
        app()
          .get(DatabaseService)
          .db.prepare(
            `UPDATE libraries SET kind = 'shows', view_mode = 'grouped', sort = 'bogus' WHERE id = ?`,
          )
          .run(library.id)
        expect((await api().getLibrary(library.id)).settings).toMatchObject({
          kind: 'shows',
          view: 'grid',
          sort: 'title',
        })
        await putLibrary({ kind: 'other', sort: 'title', view: 'grid', groupBy: 'resolution' })
      })

      it('remembers how the library is sorted and shown', async () => {
        const updated = await putLibrary({ sort: 'largest', view: 'tiles', groupBy: 'codec' })
        expect(updated.settings).toMatchObject({ sort: 'largest', view: 'tiles', groupBy: 'codec' })
        await putLibrary({ sort: 'title', view: 'grid', groupBy: 'resolution' })
      })

      it('shuffles by the seed it is sent', async () => {
        const order = async (seed: number) =>
          (await api().listMedia({ libraryId: library.id, sort: 'random', seed })).map(
            (item) => item.id,
          )
        const first = await order(11)
        expect(first).toHaveLength(2)
        expect(await order(11)).toEqual(first)
      })

      it('changes one setting, keeps the rest, and does not rescan', async () => {
        const updated = await putLibrary({ pinned: false })
        expect(updated.settings).toEqual({
          saveProgress: true,
          pinned: false,
          sort: 'title',
          view: 'grid',
          groupBy: 'resolution',
          watchedPercent: 90,
          kind: 'other',
          ratingsSource: 'tmdb',
          autoRefresh: true,
          locked: false,
        })
        expect(updated.scan.state).toBe('idle')
        expect((await putLibrary({ pinned: true })).settings.pinned).toBe(true)
      })

      it('with progress saving off, hides saved spots, saves nothing, and keeps them for later', async () => {
        const [movie] = await listMedia(library.id)
        const id = movie?.id ?? -1
        await api().saveProgress({ id, position: 2 })

        await putLibrary({ saveProgress: false })
        expect(await positionOf(id)).toBe(0)
        expect((await listMedia(library.id)).every((item) => item.position === 0)).toBe(true)
        await api().saveProgress({ id, position: 4 })

        await putLibrary({ saveProgress: true })
        expect(await positionOf(id)).toBe(2)
      })
    })

    it("stores each video's tracks when the scan probes it", async () => {
      const [movie] = await listMedia(library.id)
      expect(
        app()
          .get(MediaIndex)
          .storedTracks(movie?.id ?? -1)?.audio,
      ).toHaveLength(1)
      expect((await api().getTracks(movie?.id ?? -1)).audio).toHaveLength(1)
    })

    it('fills in tracks a video indexed before they were stored is missing, on the next scan', async () => {
      const [movie] = await listMedia(library.id)
      const id = movie?.id ?? -1
      // As a row probed before tracks were stored is.
      app().get(DatabaseService).db.prepare('UPDATE media SET tracks = NULL WHERE id = ?').run(id)
      expect(app().get(MediaIndex).storedTracks(id)).toBeNull()
      await api().scanLibrary(library.id)
      await settle(library.id)
      expect(app().get(MediaIndex).storedTracks(id)?.audio).toHaveLength(1)
    })

    it('drops files that disappear on the next scan, and their thumbnails', async () => {
      const added = join(state.media, 'Movies', 'Extra Clip.mp4')
      await encodeClip({ path: added, seconds: 2 })
      await api().scanLibrary(library.id)
      await settle(library.id)
      const extra = (await listMedia(library.id)).find((item) => item.title === 'Extra Clip')
      expect(extra?.thumbnail).toBe('ready')
      const thumbnail = app()
        .get(ThumbnailService)
        .pathFor(extra?.id ?? -1)
      await expect(stat(thumbnail)).resolves.toBeTruthy()

      await rm(added)
      // A scan whose write fails keeps the row, and so the thumbnail the row says is ready.
      const failing = vi.spyOn(app().get(MediaIndex), 'apply').mockImplementationOnce(() => {
        throw new Error('disk I/O error')
      })
      await api().scanLibrary(library.id)
      await settle(library.id)
      failing.mockRestore()
      expect((await listMedia(library.id)).map((item) => item.title)).toContain('Extra Clip')
      await expect(stat(thumbnail)).resolves.toBeTruthy()

      await api().scanLibrary(library.id)
      await settle(library.id)
      expect((await listMedia(library.id)).map((item) => item.title)).not.toContain('Extra Clip')
      await expect(stat(thumbnail)).rejects.toThrow()
    })

    it('keeps media when a library path goes missing, and says so', async () => {
      await api().updateLibrary({
        id: library.id,
        input: { name: 'Everything', paths: [...paths(), '/nowhere/at/all'] },
      })
      await settle(library.id)
      const current = await api().getLibrary(library.id)
      expect(current.scan.error).toBe('Could not read /nowhere/at/all.')
      expect(current.itemCount).toBe(2)
    })

    describe('favourites', () => {
      const favouriteIds = async (): Promise<number[]> =>
        (await api().listFavourites()).map((entry) => entry.media.id)

      it('marks a video as a favourite and lists it', async () => {
        const [movie] = await listMedia(library.id)
        const marked = await api().setFavourite({ id: movie?.id ?? -1, favourite: true })
        expect(marked.favourite).toBe(true)
        expect(await favouriteIds()).toEqual([movie?.id])
        expect((await listMedia(library.id))[0]?.favourite).toBe(true)
      })

      it('lists the most recently marked first, and forgets one that is unmarked', async () => {
        const [movie, episode] = await listMedia(library.id)
        await api().setFavourite({ id: episode?.id ?? -1, favourite: true })
        expect((await api().listFavourites()).map((entry) => entry.media.title)).toEqual([
          'Show - S01E01',
          'Big Buck Test 2008',
        ])
        const unmarked = await api().setFavourite({ id: movie?.id ?? -1, favourite: false })
        expect(unmarked.favourite).toBe(false)
        expect(await favouriteIds()).toEqual([episode?.id])
      })

      it('rejects a flag that is not a boolean', async () => {
        const [movie] = await listMedia(library.id)
        // Not a body the client can send, so sent by hand.
        const response = await app().inject({
          method: 'PUT',
          url: `/api/media/${movie?.id}/favourite`,
          payload: { favourite: 'yes' },
        })
        expect(response.statusCode).toBe(400)
        await expect(api().setFavourite({ id: 999_999, favourite: true })).rejects.toMatchObject({
          status: 404,
        })
      })
    })

    describe('home', () => {
      const shelfOf = async (libraryId: number) =>
        (await api().getHome()).shelves.find((shelf) => shelf.libraryId === libraryId)

      it("shows what is in progress, then a pinned library's newest arrivals", async () => {
        const [movie] = await listMedia(library.id)
        const id = movie?.id ?? -1
        await api().saveProgress({ id, position: 3 })
        try {
          const home = await api().getHome()
          // A file matched to nothing has no poster to stand for it.
          expect(
            home.inProgress.map(({ media, poster }) => [media.id, media.position, poster]),
          ).toEqual([[id, 3, null]])
          expect(await shelfOf(library.id)).toEqual({
            libraryId: library.id,
            type: 'media',
            media: await api().listMedia({ libraryId: library.id, sort: 'added' }),
          })
        } finally {
          // Barely started again: the spot is cleared.
          await api().saveProgress({ id, position: 0 })
        }
        expect((await api().getHome()).inProgress).toEqual([])
      })

      it('leaves out a library that is not pinned', async () => {
        const input = { name: 'Everything', paths: paths() }
        await api().updateLibrary({
          id: library.id,
          input: { ...input, settings: { pinned: false } },
        })
        try {
          expect(await shelfOf(library.id)).toBeUndefined()
        } finally {
          await api().updateLibrary({
            id: library.id,
            input: { ...input, settings: { pinned: true } },
          })
        }
      })
    })

    describe('history', () => {
      const entryFor = async ({ id, watchedOnly }: { id: number; watchedOnly?: boolean }) =>
        (await api().listHistory({ libraryId: library.id, limit: 100, watchedOnly })).find(
          (entry) => entry.media.id === id,
        )

      it('records a play, and lists it as watched once playback gets far enough', async () => {
        const [, episode] = await listMedia(library.id)
        const id = episode?.id ?? -1
        await api().recordPlay(id)
        expect(await entryFor({ id })).toMatchObject({ plays: 1, furthest: 0, watched: false })
        expect(await entryFor({ id, watchedOnly: true })).toBeUndefined()

        await api().saveProgress({ id, position: episode?.duration ?? 0 })
        expect(await entryFor({ id, watchedOnly: true })).toMatchObject({
          plays: 1,
          watched: true,
        })
      })

      it('keeps to the limit it is asked for', async () => {
        expect(await api().listHistory({ libraryId: library.id, limit: 1 })).toHaveLength(1)
      })

      it('says when the video or the library is not there', async () => {
        await expect(api().recordPlay(999_999)).rejects.toMatchObject({ status: 404 })
        await expect(api().listHistory({ libraryId: 999_999, limit: 1 })).rejects.toMatchObject({
          status: 404,
        })
      })
    })

    describe('deleting a video', () => {
      const indexed = async (title: string): Promise<MediaItem> => {
        await api().scanLibrary(library.id)
        await settle(library.id)
        const item = (await listMedia(library.id)).find((entry) => entry.title === title)
        if (!item) throw new Error(`${title} was not indexed`)
        return item
      }

      it('removes the file from disk along with its row, thumbnail and favourite', async () => {
        const path = join(state.media, 'Movies', 'Doomed.mp4')
        await encodeClip({ path, seconds: 2 })
        const doomed = await indexed('Doomed')
        await api().setFavourite({ id: doomed.id, favourite: true })
        const thumbnail = app().get(ThumbnailService).pathFor(doomed.id)
        await expect(stat(thumbnail)).resolves.toBeTruthy()

        await api().deleteMedia(doomed.id)
        await expect(stat(path)).rejects.toThrow()
        await expect(stat(thumbnail)).rejects.toThrow()
        await expect(api().getMedia(doomed.id)).rejects.toMatchObject({ status: 404 })
        await expect(api().deleteMedia(doomed.id)).rejects.toMatchObject({ status: 404 })
        expect((await api().listFavourites()).map((entry) => entry.media.id)).not.toContain(
          doomed.id,
        )
        expect((await api().getLibrary(library.id)).itemCount).toBe(2)
      })

      it('drops the row when the file is already gone', async () => {
        const path = join(state.media, 'Movies', 'Vanished.mp4')
        await encodeClip({ path, seconds: 2 })
        const vanished = await indexed('Vanished')
        await rm(path)
        await api().deleteMedia(vanished.id)
        expect((await listMedia(library.id)).map((item) => item.id)).not.toContain(vanished.id)
      })

      // Root can unlink from any folder, so the failure cannot be staged there.
      it.skipIf(process.getuid?.() === 0)(
        'keeps the video when the file cannot be removed',
        async () => {
          const locked = join(state.media, 'TV', 'Locked')
          const path = join(locked, 'Kept.mp4')
          await encodeClip({ path, seconds: 2 })
          const kept = await indexed('Kept')
          await chmod(locked, 0o555)
          try {
            await expect(api().deleteMedia(kept.id)).rejects.toMatchObject({
              status: 500,
              message: expect.stringContaining('Could not delete the file'),
            })
            await expect(stat(path)).resolves.toBeTruthy()
            await expect(api().getMedia(kept.id)).resolves.toMatchObject({ id: kept.id })
          } finally {
            await chmod(locked, 0o755)
          }
          // Writable again, the same request goes through.
          await api().deleteMedia(kept.id)
          await rm(locked, { recursive: true, force: true })
        },
      )
    })
  })

  describe('folder browser', () => {
    it('lists folders under the browse root, hiding dot folders', async () => {
      const listing = await api().browse(join(state.media, 'Movies'))
      expect(listing.directories).toEqual([])
      const top = await api().browse()
      expect(top.parent).toBeNull()
      expect(top.directories.map((entry) => entry.name)).toEqual(['Movies', 'TV'])
    })

    it('refuses to leave the browse root', async () => {
      await expect(api().browse(state.root)).rejects.toMatchObject({ status: 400 })
    })
  })

  it('deletes a library with its media and thumbnails', async () => {
    const [created] = await api().listLibraries()
    await api().deleteLibrary(created?.id ?? -1)
    await expect(api().getLibrary(created?.id ?? -1)).rejects.toMatchObject({ status: 404 })
  })
})

describe('refreshing a library as its folders change', () => {
  const state: {
    root: string
    media: string
    libraryId: number
    app: NestFastifyApplication | null
  } = { root: '', media: '', libraryId: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app() })
  const at = (...parts: string[]) => join(state.media, ...parts)
  const listMedia = (): Promise<MediaItem[]> =>
    api().listMedia({ libraryId: state.libraryId, sort: 'changed' })
  const fileNames = (items: MediaItem[]): string[] => items.map((item) => item.fileName).toSorted()

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-refresh-'))
    state.media = join(state.root, 'media')
    await encodeClip({ path: at('Heat (1995).mp4'), seconds: 2 })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: { quietMs: 100 },
    })
    await state.app.listen(0, '127.0.0.1')
    const created = await api().createLibrary({ name: 'Watched', paths: [state.media] })
    state.libraryId = created.id
    await app().get(ScannerService).whenIdle(created.id)
    // The watch is set up a moment after the library is saved.
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('takes in a video added to a folder under it', async () => {
    await mkdir(at('Ronin (1998)'))
    await copyFile(at('Heat (1995).mp4'), at('Ronin (1998)', 'Ronin (1998).mp4'))
    const items = await eventually({
      read: listMedia,
      check: (current) => current.some((item) => item.fileName === 'Ronin (1998).mp4'),
    })
    expect(items.find((item) => item.fileName === 'Ronin (1998).mp4')?.folder).toBe('Ronin (1998)')
  })

  it('follows a renamed video: the same video, moved up Recently changed', async () => {
    const before = (await listMedia()).find((item) => item.fileName === 'Heat (1995).mp4')
    await api().setFavourite({ id: before?.id ?? -1, favourite: true })
    await rename(at('Heat (1995).mp4'), at('Heat (1995) 1080p.mp4'))
    const items = await eventually({
      read: listMedia,
      check: (current) => current.some((item) => item.fileName === 'Heat (1995) 1080p.mp4'),
    })
    expect(fileNames(items)).toEqual(['Heat (1995) 1080p.mp4', 'Ronin (1998).mp4'])
    expect(items[0]).toMatchObject({ id: before?.id, favourite: true, title: 'Heat (1995) 1080p' })
    expect((items[0]?.changedAt ?? '') > (before?.changedAt ?? '')).toBe(true)
    expect(items[0]?.addedAt).toBe(before?.addedAt)
  })

  it('drops a video deleted from its folder', async () => {
    await rm(at('Ronin (1998)'), { recursive: true })
    const items = await eventually({
      read: listMedia,
      check: (current) => current.length === 1,
    })
    expect(fileNames(items)).toEqual(['Heat (1995) 1080p.mp4'])
  })

  it('tells a listening client which library changed', async () => {
    const abort = new AbortController()
    // A real request over the port: an event stream stays open, which `inject` cannot.
    const response = await fetch(`${await app().getUrl()}${api().eventsUrl()}`, {
      signal: abort.signal,
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body?.getReader()
    await copyFile(at('Heat (1995) 1080p.mp4'), at('Heat (1995) copy.mp4'))
    const read = async (text: string): Promise<string> => {
      const chunk = await reader?.read()
      const next = text + new TextDecoder().decode(chunk?.value)
      return next.includes('data:') || chunk?.done ? next : read(next)
    }
    const message = await read('')
    abort.abort()
    const data = message.split('\n').find((line) => line.startsWith('data:')) ?? ''
    expect(parseServerEvent(data.slice('data:'.length).trim())).toEqual({
      type: 'library',
      libraryId: state.libraryId,
    })
  })

  it('leaves the library alone once it no longer refreshes automatically', async () => {
    await api().updateLibrary({
      id: state.libraryId,
      input: { name: 'Watched', paths: [state.media], settings: { autoRefresh: false } },
    })
    const before = fileNames(await listMedia())
    await copyFile(at('Heat (1995) 1080p.mp4'), at('Unwatched.mp4'))
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(fileNames(await listMedia())).toEqual(before)
  })
})

/** As a browser with the admin lock off, the one place the PIN opens anything. */
describe('a library locked behind the PIN', () => {
  const state: {
    root: string
    admin: string
    open: number
    private: number
    privateVideo: number
    privateItem: number
    app: NestFastifyApplication | null
  } = { root: '', admin: '', open: 0, private: 0, privateVideo: 0, privateItem: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** The client as a browser holding `cookie`, or none, beside its admin session. */
  const api = (cookie?: string): ApiClient =>
    apiFor({ app: app(), cookie: cookies(state.admin, cookie) })
  /** A request by hand from the same browser. */
  const inject = ({ method, url }: { method: (typeof ROUTE_METHODS)[number]; url: string }) =>
    app().inject({ method, url, headers: { cookie: state.admin } })
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)
  /**
   * Unlocking by hand: the client's `unlock` is answered with a cookie the
   * browser keeps, which a test has to read off the response itself.
   */
  const unlock = async (pin: string) => {
    const response = await app().inject({
      method: 'POST',
      url: '/api/lock/unlock',
      payload: { pin },
    })
    return { response, cookie: cookieSet(response) }
  }
  const createLibrary = async (input: LibraryInput): Promise<number> => {
    const created = await api().createLibrary(input)
    await app().get(ScannerService).whenIdle(created.id)
    return created.id
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-locked-'))
    await encodeClip({ path: at('Open', 'Heat (1995).mp4'), seconds: 2 })
    await encodeClip({ path: at('Private', 'Lesson One.mp4'), seconds: 2 })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        libraryPin: '3001',
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    state.open = await createLibrary({ name: 'Open', paths: [at('Open')] })
    state.private = await createLibrary({
      name: 'Tutorials',
      paths: [at('Private')],
      settings: { locked: true },
    })
    const [video] = app().get(MediaIndex).idsForLibrary(state.private)
    state.privateVideo = video ?? 0
    // A movie only the locked library holds, as if it had been matched.
    const metadata = app().get(MetadataRepository)
    state.privateItem = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: '7001', number: null, title: 'Lesson One' },
    })
    metadata.link({ mediaIds: [state.privateVideo], itemIds: [state.privateItem] })
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('lists the library, saying it is locked', async () => {
    const libraries = await api().listLibraries()
    expect(libraries.map((library) => [library.name, library.settings.locked])).toEqual([
      ['Open', false],
      ['Tutorials', true],
    ])
    expect(await api().getLock()).toEqual({ available: true, unlocked: false })
  })

  it("keeps a locked library's folders and picture to itself until it is unlocked", async () => {
    await app().get(ThumbnailService).whenIdle()
    const shown = async (holding?: string) =>
      (await api(holding).listLibraries()).map((library) => ({
        paths: library.paths,
        backdrop: library.backdrop?.type ?? null,
      }))
    expect(await shown()).toEqual([
      { paths: [at('Open')], backdrop: 'thumbnail' },
      { paths: [], backdrop: null },
    ])
    expect(await api().getLibrary(state.private)).toMatchObject({ paths: [], backdrop: null })
    const { cookie } = await unlock('3001')
    expect(await shown(cookie)).toEqual([
      { paths: [at('Open')], backdrop: 'thumbnail' },
      { paths: [at('Private')], backdrop: 'thumbnail' },
    ])
    expect((await api(cookie).getLibrary(state.private)).backdrop).toEqual({
      type: 'thumbnail',
      id: state.privateVideo,
      version: expect.any(Number),
    })
  })

  it("says a locked library's scan failed without naming its folders", async () => {
    const id = await createLibrary({
      name: 'Gone',
      paths: [at('Missing')],
      settings: { locked: true },
    })
    const { cookie } = await unlock('3001')
    try {
      expect((await api().getLibrary(id)).scan.error).toBe(LOCKED_SCAN_ERROR)
      const listed = await api().listLibraries()
      expect(listed.find((library) => library.id === id)?.scan.error).toBe(LOCKED_SCAN_ERROR)
      expect((await api(cookie).getLibrary(id)).scan.error).toContain(at('Missing'))
    } finally {
      await api(cookie).deleteLibrary(id)
    }
  })

  it('holds back its videos, their files, pictures and paths, and its history', async () => {
    const id = state.privateVideo
    const refused = await Promise.all(
      [
        api().listMedia({ libraryId: state.private }),
        api().listHistory({ libraryId: state.private, limit: 10 }),
        api().getMedia(id),
        api().getMediaLocation(id),
        api().getTracks(id),
      ].map((call) =>
        call.then(
          () => 'answered',
          (error: unknown) => error,
        ),
      ),
    )
    expect(refused).toEqual(refused.map(() => expect.objectContaining({ status: 423 })))
    // What the client only builds an address for, a player loads by hand.
    const loaded = await Promise.all(
      [
        api().fileUrl(id),
        `/api/media/${id}/thumbnail`,
        api().streamUrl({ id, mode: 'remux', start: 0, audio: null }),
      ].map(async (url) => (await inject({ method: 'GET', url })).statusCode),
    )
    expect(loaded).toEqual([423, 423, 423])
    await expect(api().listMedia({ libraryId: state.open })).resolves.toHaveLength(1)
  })

  it('holds back every route that takes an id from it, whatever the method', async () => {
    const ids: Record<Privacy, number> = {
      library: state.private,
      media: state.privateVideo,
      item: state.privateItem,
    }
    const held = routeMarks(CONTROLLERS).flatMap((route) =>
      route.mark == null || route.mark === 'public' || !isRouteMethod(route.method)
        ? []
        : [
            {
              method: route.method,
              url: route.path.replace(':id', String(ids[route.mark])).replace(/:\w+/g, 'poster'),
            },
          ],
    )
    expect(routeMarks(CONTROLLERS).every((route) => isRouteMethod(route.method))).toBe(true)
    expect(held.length).toBeGreaterThan(25)
    const answers = await Promise.all(
      held.map(async ({ method, url }) => {
        const response = await inject({ method, url })
        return `${method} ${url} ${response.statusCode}`
      }),
    )
    expect(answers).toEqual(held.map(({ method, url }) => `${method} ${url} 423`))
  })

  it('opens with the PIN, and shuts again when locked', async () => {
    await expect(api().unlock('1234')).rejects.toMatchObject({ status: 401 })
    const { response, cookie } = await unlock('3001')
    expect(response.statusCode).toBe(200)
    expect(response.headers['set-cookie']).toContain('HttpOnly')
    await expect(api(cookie).listMedia({ libraryId: state.private })).resolves.toHaveLength(1)
    expect(await api(cookie).getLock()).toEqual({ available: true, unlocked: true })

    await api(cookie).setFavourite({ id: state.privateVideo, favourite: true })
    const favourites = async (holding?: string) =>
      (await api(holding).listFavourites()).map((entry) => entry.media.id)
    expect(await favourites(cookie)).toEqual([state.privateVideo])
    expect(await favourites()).toEqual([])

    // The cookie that forgets the session is only in the response's headers.
    const locked = await app().inject({ method: 'POST', url: '/api/lock/lock' })
    expect(locked.headers['set-cookie']).toContain('Max-Age=0')
    await expect(
      api('raven_unlock=1.forged').listMedia({ libraryId: state.private }),
    ).rejects.toMatchObject({ status: 423 })
  })

  it('keeps a locked library off the home page until it is unlocked', async () => {
    const { cookie } = await unlock('3001')
    await api(cookie).saveProgress({ id: state.privateVideo, position: 1 })
    const home = async (holding?: string) => {
      const answer = await api(holding).getHome()
      return {
        inProgress: answer.inProgress.map((entry) => entry.media.id),
        shelves: answer.shelves.map((shelf) => shelf.libraryId),
      }
    }
    expect(await home(cookie)).toEqual({
      inProgress: [state.privateVideo],
      shelves: [state.open, state.private],
    })
    expect(await home()).toEqual({ inProgress: [], shelves: [state.open] })
  })

  it('stays locked whatever its type', async () => {
    const { cookie } = await unlock('3001')
    const { name, paths } = await api(cookie).getLibrary(state.private)
    const answers = await LIBRARY_KINDS.reduce<Promise<string[]>>(async (done, kind) => {
      const before = await done
      const saved = await api(cookie).updateLibrary({
        id: state.private,
        input: { name, paths, settings: { kind } },
      })
      const status = await api()
        .listMedia({ libraryId: state.private })
        .then(
          () => 200,
          (error: unknown) => (isRecord(error) ? error.status : error),
        )
      return [...before, `${saved.settings.kind} locked=${saved.settings.locked} ${status}`]
    }, Promise.resolve([]))
    expect(answers).toEqual(LIBRARY_KINDS.map((kind) => `${kind} locked=true 423`))
    await app().get(MetadataService).whenIdle()
  })

  it('refuses an unlock that sends no PIN, saying why', async () => {
    const response = await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: {} })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ message: 'pin must be text' })
  })

  it('waits a minute after five wrong PINs in a row', async () => {
    const statuses = await Array.from({ length: 6 }).reduce<Promise<unknown[]>>(
      async (done) => [
        ...(await done),
        await api()
          .unlock('0000')
          .catch((error: unknown) => (isRecord(error) ? error.status : error)),
      ],
      Promise.resolve([]),
    )
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    await expect(api().unlock('3001')).rejects.toMatchObject({ status: 429 })
  })
})

describe('the admin lock', () => {
  const state: {
    root: string
    admin: string
    pin: string
    open: number
    openVideo: number
    private: number
    privateVideo: number
    privateItem: number
    app: NestFastifyApplication | null
  } = {
    root: '',
    admin: '',
    pin: '',
    open: 0,
    openVideo: 0,
    private: 0,
    privateVideo: 0,
    privateItem: 0,
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** The client as a browser holding `cookie`; with none, the admin lock is on for it. */
  const api = (...cookie: string[]): ApiClient => apiFor({ app: app(), cookie: cookies(...cookie) })
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)
  /** The status a call fails with, or 200. */
  const status = (call: Promise<unknown>): Promise<unknown> =>
    call.then(
      () => 200,
      (error: unknown) => (isRecord(error) ? error.status : error),
    )
  /** A POST to the admin lock by hand, for the cookie its answer sets. */
  const post = async ({ path, cookie }: { path: string; cookie: string }) => {
    const response = await app().inject({
      method: 'POST',
      url: `/api/admin/${path}`,
      headers: { cookie },
    })
    return { status: response.statusCode, body: response.json(), cookie: cookieSet(response) }
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-admin-'))
    await encodeClip({ path: at('Open', 'Heat (1995).mp4'), seconds: 2 })
    await encodeClip({ path: at('Private', 'Lesson One.mp4'), seconds: 2 })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        libraryPin: '3001',
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const created = async (input: LibraryInput): Promise<number> => {
      const library = await api(state.admin).createLibrary(input)
      await app().get(ScannerService).whenIdle(library.id)
      return library.id
    }
    state.open = await created({ name: 'Open', paths: [at('Open')] })
    state.private = await created({
      name: 'Tutorials',
      paths: [at('Private')],
      settings: { locked: true },
    })
    const index = app().get(MediaIndex)
    state.openVideo = index.idsForLibrary(state.open)[0] ?? 0
    state.privateVideo = index.idsForLibrary(state.private)[0] ?? 0
    const metadata = app().get(MetadataRepository)
    state.privateItem = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: '7002', number: null, title: 'Lesson One' },
    })
    metadata.link({ mediaIds: [state.privateVideo], itemIds: [state.privateItem] })
    state.pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
  })

  afterAll(async () => {
    vi.useRealTimers()
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('is on for a browser until the password is entered there', async () => {
    expect(await api().getAdminLock()).toEqual({ state: 'on', available: true })
    expect(await api(state.admin).getAdminLock()).toEqual({ state: 'off' })
  })

  it('leaves locked libraries out altogether, PIN or not', async () => {
    const names = async (...cookie: string[]) =>
      (await api(...cookie).listLibraries()).map((library) => library.name)
    expect(await names()).toEqual(['Open'])
    expect(await names(state.pin)).toEqual(['Open'])
    expect(await names(state.admin)).toEqual(['Open', 'Tutorials'])
    expect(await api(state.pin).getLock()).toEqual({ available: true, unlocked: false })
    expect(await api(state.admin, state.pin).getLock()).toEqual({ available: true, unlocked: true })

    const hidden = [
      api(state.pin).getLibrary(state.private),
      api(state.pin).listMedia({ libraryId: state.private }),
      api(state.pin).getMedia(state.privateVideo),
      api(state.pin).getItem(state.privateItem),
    ]
    expect(await Promise.all(hidden.map(status))).toEqual([404, 404, 404, 404])
    await expect(api().getMedia(state.privateVideo)).rejects.toMatchObject({
      message: `No media ${state.privateVideo}`,
    })
    // With the admin lock off, a locked library asks for the PIN as it always has.
    expect(await status(api(state.admin).listMedia({ libraryId: state.private }))).toBe(423)
    await expect(
      api(state.admin, state.pin).listMedia({ libraryId: state.private }),
    ).resolves.toHaveLength(1)
  })

  it('will not delete a video or say where its file is', async () => {
    const id = state.openVideo
    expect(await status(api().getMediaLocation(id))).toBe(403)
    expect(await status(api().deleteMedia(id))).toBe(403)
    expect((await stat(at('Open', 'Heat (1995).mp4'))).isFile()).toBe(true)
    await expect(api().getMedia(id)).resolves.toMatchObject({ id })
    expect(await api(state.admin).getMediaLocation(id)).toEqual({
      path: at('Open', 'Heat (1995).mp4'),
    })
  })

  it('will not lock a library, which would put it out of sight', async () => {
    const { name, paths } = await api().getLibrary(state.open)
    const locking = api().updateLibrary({
      id: state.open,
      input: { name, paths, settings: { locked: true } },
    })
    await expect(locking).rejects.toMatchObject({
      status: 403,
      message: 'Turn the admin lock off in Settings to lock a library.',
    })
    expect(
      await status(
        api().createLibrary({ name: 'Secret', paths: [at('Open')], settings: { locked: true } }),
      ),
    ).toBe(403)
    // Saving another setting of an open library is fine.
    const saved = await api().updateLibrary({
      id: state.open,
      input: { name, paths, settings: { pinned: false } },
    })
    expect(saved.settings).toMatchObject({ pinned: false, locked: false })
  })

  it('turns off only with the password', async () => {
    await expect(api().unlockAdmin('raven-admin-2026')).rejects.toMatchObject({
      status: 401,
      message: 'That password is not right.',
    })
    const response = await app().inject({
      method: 'POST',
      url: '/api/admin/unlock',
      payload: { password: ADMIN_PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ state: 'off' })
    expect(response.headers['set-cookie']).toContain('HttpOnly')
    expect(
      await status(api('raven_admin=99999999999999..forged').getMediaLocation(state.openVideo)),
    ).toBe(403)
  })

  it('turns back on after a wait, in which it goes off again with no password', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const turning = await post({ path: 'lock', cookie: state.admin })
    expect(turning).toMatchObject({
      status: 200,
      body: { state: 'turningOn', remainingMs: 15_000 },
    })
    // Until it holds, it is still off.
    await expect(api(turning.cookie).getMediaLocation(state.openVideo)).resolves.toBeDefined()

    const kept = await post({ path: 'keep-unlocked', cookie: turning.cookie })
    expect(kept).toMatchObject({ status: 200, body: { state: 'off' } })
    expect(await api(kept.cookie).getAdminLock()).toEqual({ state: 'off' })

    const again = await post({ path: 'lock', cookie: kept.cookie })
    vi.setSystemTime(Date.now() + 15_000)
    expect(await api(again.cookie).getAdminLock()).toEqual({ state: 'on', available: true })
    expect(await status(api(again.cookie).getMediaLocation(state.openVideo))).toBe(403)
    expect(await api(again.cookie).listLibraries()).toHaveLength(1)
    const late = await post({ path: 'keep-unlocked', cookie: again.cookie })
    expect(late).toMatchObject({
      status: 409,
      body: { message: 'The admin lock is on already. Enter the password to turn it off.' },
    })
    vi.useRealTimers()
  })
})

describe('the order of libraries', () => {
  const state: { root: string; app: NestFastifyApplication | null } = { root: '', app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)
  // Scope 4K: short of 2160 lines, but 4K by its width.
  const SCOPE_4K = '3200x1340'

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-order-'))
    await Promise.all([
      encodeClip({ path: at('Clips', 'Small.mp4'), seconds: 1 }),
      encodeClip({ path: at('UHD', 'Wide.mp4'), seconds: 1, size: SCOPE_4K }),
      encodeClip({ path: at('Mixed', 'Wide.mp4'), seconds: 1, size: SCOPE_4K }),
      encodeClip({ path: at('Mixed', 'Small.mp4'), seconds: 1 }),
    ])
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('leads with the libraries whose videos are mostly 4K, then goes by name', async () => {
    const api = apiFor({ app: app() })
    const create = async (input: LibraryInput) => {
      const created = await api.createLibrary(input)
      await app().get(ScannerService).whenIdle(created.id)
    }
    await create({ name: 'Anime', paths: [at('Clips')] })
    await create({ name: 'Mixed', paths: [at('Mixed')] })
    await create({ name: 'Zulu', paths: [at('UHD')] })
    expect((await api.listLibraries()).map((library) => library.name)).toEqual([
      'Zulu',
      'Anime',
      'Mixed',
    ])
  })
})

describe('a library whose folders cannot be watched', () => {
  const state: {
    root: string
    libraryId: number
    app: NestFastifyApplication | null
    /** Every watch asked for, and whether it should fail. */
    watches: string[]
    failing: boolean
  } = { root: '', libraryId: 0, app: null, watches: [], failing: true }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app() })
  const media = () => join(state.root, 'media')
  const listMedia = (): Promise<MediaItem[]> => api().listMedia({ libraryId: state.libraryId })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-unwatched-'))
    await encodeClip({ path: join(media(), 'Heat (1995).mp4'), seconds: 2 })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: {
        fallbackScanMs: 100,
        watchFolder: ({ root, onError }) => {
          state.watches.push(root)
          if (state.failing)
            onError(new Error('ENOSPC: System limit for number of file watchers reached'))
          return { close: () => undefined }
        },
      },
    })
    await state.app.init()
    const created = await api().createLibrary({ name: 'Unwatched', paths: [media()] })
    state.libraryId = created.id
    await app().get(ScannerService).whenIdle(created.id)
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('is scanned on a timer instead, so new videos still turn up', async () => {
    await copyFile(join(media(), 'Heat (1995).mp4'), join(media(), 'Ronin (1998).mp4'))
    const items = await eventually({
      read: listMedia,
      check: (current) => current.length === 2,
    })
    expect(items.map((item) => item.fileName).toSorted()).toEqual([
      'Heat (1995).mp4',
      'Ronin (1998).mp4',
    ])
  })

  it('is watched again once a library is saved', async () => {
    const before = state.watches.length
    state.failing = false
    await api().updateLibrary({
      id: state.libraryId,
      input: { name: 'Unwatched again', paths: [media()] },
    })
    expect(state.watches.length).toBe(before + 1)
  })
})

describe('serving the web app', () => {
  const state: { root: string; app: NestFastifyApplication | null } = { root: '', app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-web-'))
    const web = join(state.root, 'web')
    await mkdir(join(web, 'assets'), { recursive: true })
    await writeFile(join(web, 'index.html'), '<!doctype html><title>raven</title>')
    await writeFile(join(web, 'assets', 'app-1234.js'), 'console.log(1)')
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root, webDir: web }),
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('answers client-side routes with index.html', async () => {
    const response = await app().inject({ method: 'GET', url: '/library/3' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<title>raven</title>')
  })

  it('caches fingerprinted assets for good', async () => {
    const response = await app().inject({ method: 'GET', url: '/assets/app-1234.js' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('immutable')
  })

  it('keeps API 404s as JSON', async () => {
    await expect(apiFor({ app: app() }).getMedia(999)).rejects.toMatchObject({ status: 404 })
    const response = await app().inject({ method: 'GET', url: '/api/media/999' })
    expect(response.json()).toMatchObject({ statusCode: 404 })
  })
})
