import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  type LibraryInput,
  type LibrarySettings,
  type MediaItem,
  isScanning,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, isRouteMethod, keysOf, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

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
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
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

      it("starts a library with progress saved, pinned, watched at 90%, of no particular type and wearing its type's icon", async () => {
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
          folderLayout: 'auto',
          icon: null,
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
          folderLayout: 'auto',
          icon: null,
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
          await rm(locked, { recursive: true, force: true, maxRetries: 5 })
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
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
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
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
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
