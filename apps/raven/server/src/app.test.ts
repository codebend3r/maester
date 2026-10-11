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
  type HistoryEntry,
  type Library,
  type MediaItem,
  isDirectoryListing,
  isHistory,
  isLibrary,
  isLibraryList,
  isMediaItem,
  isMediaList,
  isLockState,
  isMediaLocation,
  parseServerEvent,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { CONTROLLERS } from '@/appModule'
import { type ServerConfig, readServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { routeMarks } from '@/lock/lockGuard'
import type { Privacy } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { ScannerService } from '@/scanner/scannerService'
import { encodeClip } from '@/test/clips'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = {
  statusCode: number
  headers: Record<string, unknown>
  rawPayload: Buffer
  json: () => unknown
}

const expectShape = <T>({
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
})

describe('the media server', () => {
  const state = {
    root: '',
    media: '',
    data: '',
    app: null as NestFastifyApplication | null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async (libraryId: number) => {
    await app().get(ScannerService).whenIdle(libraryId)
    await app().get(ThumbnailService).whenIdle()
  }
  const listMedia = async (libraryId: number): Promise<MediaItem[]> =>
    expectShape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${libraryId}/media` }),
      guard: isMediaList,
    })

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
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('rejects a library without a name or folder', async () => {
    const response = await app().inject({
      method: 'POST',
      url: '/api/libraries',
      payload: { name: ' ', paths: [] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      message: ['Give the library a name.', 'Add at least one folder.'],
    })
  })

  describe('with a library', () => {
    const library = { id: 0 }

    beforeAll(async () => {
      const response = await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: {
          name: 'Everything',
          paths: [join(state.media, 'Movies'), join(state.media, 'TV')],
        },
      })
      expect(response.statusCode).toBe(201)
      const created: Library = expectShape({ response, guard: isLibrary })
      expect(created.scan.state).toBe('scanning')
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

    it('never sends a client the absolute path', async () => {
      const response = await app().inject({
        method: 'GET',
        url: `/api/libraries/${library.id}/media`,
      })
      expect(response.body).not.toContain(state.media)
    })

    it('will not lock a library while the server has no PIN', async () => {
      const response = await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'Private', paths: [state.media], settings: { locked: true } },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({
        message: "Set LIBRARY_PIN in raven's .env to lock a library.",
      })
    })

    it('keeps a locked library shut when the server has no PIN to open it', async () => {
      const libraries = app().get(LibrariesRepository)
      const current = libraries.get(library.id)
      if (!current) throw new Error('no library')
      const input = { name: current.name, paths: current.paths }
      libraries.update({ id: library.id, input: { ...input, settings: { locked: true } } })
      const media = await app().inject({
        method: 'GET',
        url: `/api/libraries/${library.id}/media`,
      })
      const unlock = await app().inject({
        method: 'POST',
        url: '/api/lock/unlock',
        payload: { pin: '' },
      })
      libraries.update({ id: library.id, input: { ...input, settings: { locked: false } } })
      expect(media.statusCode).toBe(423)
      expect(unlock.statusCode).toBe(503)
    })

    it("tells a client where a video's file lives when it asks", async () => {
      const [movie] = await listMedia(library.id)
      const location = expectShape({
        response: await app().inject({ method: 'GET', url: `/api/media/${movie?.id}/location` }),
        guard: isMediaLocation,
      })
      expect(location.path).toBe(join(state.media, 'Movies', 'Big.Buck.Test.2008.mp4'))
      expect(
        (await app().inject({ method: 'GET', url: '/api/media/999999/location' })).statusCode,
      ).toBe(404)
    })

    it('reports the scan and item count on the library', async () => {
      const libraries = expectShape({
        response: await app().inject({ method: 'GET', url: '/api/libraries' }),
        guard: isLibraryList,
      })
      expect(libraries).toHaveLength(1)
      expect(libraries[0]).toMatchObject({
        itemCount: 2,
        scan: { state: 'idle', discovered: 2, processed: 2, error: null },
      })
    })

    it('searches and sorts', async () => {
      const response = await app().inject({
        method: 'GET',
        url: `/api/libraries/${library.id}/media?q=s01e01&sort=added`,
      })
      expect(expectShape({ response, guard: isMediaList }).map((item) => item.title)).toEqual([
        'Show - S01E01',
      ])
    })

    it('serves a JPEG thumbnail that caches forever when versioned', async () => {
      const [movie] = await listMedia(library.id)
      const response = await app().inject({
        method: 'GET',
        url: `/api/media/${movie?.id}/thumbnail?v=${movie?.thumbnailVersion}`,
      })
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
          url: `/api/media/${movie?.id}/file`,
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
          url: `/api/media/${episode?.id}/file`,
        })
        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toBe('video/x-matroska')
        expect(response.rawPayload).toHaveLength(episode?.size ?? -1)
      })

      it('answers 416 for a range past the end', async () => {
        const [movie] = await listMedia(library.id)
        const response = await app().inject({
          method: 'GET',
          url: `/api/media/${movie?.id}/file`,
          headers: { range: `bytes=${(movie?.size ?? 0) + 10}-` },
        })
        expect(response.statusCode).toBe(416)
        expect(response.headers['content-range']).toBe(`bytes */${movie?.size}`)
      })
    })

    it('remembers where playback stopped', async () => {
      const [movie] = await listMedia(library.id)
      const save = await app().inject({
        method: 'PUT',
        url: `/api/media/${movie?.id}/progress`,
        payload: { position: 3.5 },
      })
      expect(save.statusCode).toBe(204)
      const item = expectShape({
        response: await app().inject({ method: 'GET', url: `/api/media/${movie?.id}` }),
        guard: isMediaItem,
      })
      expect(item.position).toBe(3.5)

      const bad = await app().inject({
        method: 'PUT',
        url: `/api/media/${movie?.id}/progress`,
        payload: { position: 'soon' },
      })
      expect(bad.statusCode).toBe(400)
    })

    describe('settings', () => {
      const putLibrary = async (settings: Record<string, unknown>): Promise<Library> =>
        expectShape({
          response: await app().inject({
            method: 'PUT',
            url: `/api/libraries/${library.id}`,
            payload: {
              name: 'Everything',
              paths: [join(state.media, 'Movies'), join(state.media, 'TV')],
              settings,
            },
          }),
          guard: isLibrary,
        })
      const positionOf = async (id: number): Promise<number> =>
        expectShape({
          response: await app().inject({ method: 'GET', url: `/api/media/${id}` }),
          guard: isMediaItem,
        }).position
      const saveProgress = (id: number, position: number) =>
        app().inject({ method: 'PUT', url: `/api/media/${id}/progress`, payload: { position } })

      it('starts a library with progress saved, pinned, watched at 90%, and of no particular type', async () => {
        const current = expectShape({
          response: await app().inject({ method: 'GET', url: `/api/libraries/${library.id}` }),
          guard: isLibrary,
        })
        expect(current.settings).toEqual({
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
        const current = expectShape({
          response: await app().inject({ method: 'GET', url: `/api/libraries/${library.id}` }),
          guard: isLibrary,
        })
        expect(current.settings.kind).toBe('shows')
        expect((await putLibrary({ kind: 'other' })).settings).toMatchObject({
          kind: 'other',
          view: 'grid',
          groupBy: 'resolution',
        })
      })

      it('remembers how the library is sorted and shown', async () => {
        const updated = await putLibrary({ sort: 'largest', view: 'tiles', groupBy: 'codec' })
        expect(updated.settings).toMatchObject({ sort: 'largest', view: 'tiles', groupBy: 'codec' })
        await putLibrary({ sort: 'title', view: 'grid', groupBy: 'resolution' })
      })

      it('shuffles by the seed it is sent', async () => {
        const order = async (seed: number) =>
          expectShape({
            response: await app().inject({
              method: 'GET',
              url: `/api/libraries/${library.id}/media?sort=random&seed=${seed}`,
            }),
            guard: isMediaList,
          }).map((item) => item.id)
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
        expect((await saveProgress(id, 2)).statusCode).toBe(204)

        await putLibrary({ saveProgress: false })
        expect(await positionOf(id)).toBe(0)
        expect((await listMedia(library.id)).every((item) => item.position === 0)).toBe(true)
        expect((await saveProgress(id, 4)).statusCode).toBe(204)

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
    })

    it('fills in tracks a video indexed before they were stored is missing, on the next scan', async () => {
      const [movie] = await listMedia(library.id)
      const id = movie?.id ?? -1
      // As a row probed before tracks were stored is.
      app().get(DatabaseService).db.prepare('UPDATE media SET tracks = NULL WHERE id = ?').run(id)
      expect(app().get(MediaIndex).storedTracks(id)).toBeNull()
      await app().inject({ method: 'POST', url: `/api/libraries/${library.id}/scan` })
      await settle(library.id)
      expect(app().get(MediaIndex).storedTracks(id)?.audio).toHaveLength(1)
    })

    it('drops files that disappear on the next scan, and their thumbnails', async () => {
      const added = join(state.media, 'Movies', 'Extra Clip.mp4')
      await encodeClip({ path: added, seconds: 2 })
      await app().inject({ method: 'POST', url: `/api/libraries/${library.id}/scan` })
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
      await app().inject({ method: 'POST', url: `/api/libraries/${library.id}/scan` })
      await settle(library.id)
      failing.mockRestore()
      expect((await listMedia(library.id)).map((item) => item.title)).toContain('Extra Clip')
      await expect(stat(thumbnail)).resolves.toBeTruthy()

      await app().inject({ method: 'POST', url: `/api/libraries/${library.id}/scan` })
      await settle(library.id)
      expect((await listMedia(library.id)).map((item) => item.title)).not.toContain('Extra Clip')
      await expect(stat(thumbnail)).rejects.toThrow()
    })

    it('keeps media when a library path goes missing, and says so', async () => {
      const update = await app().inject({
        method: 'PUT',
        url: `/api/libraries/${library.id}`,
        payload: {
          name: 'Everything',
          paths: [join(state.media, 'Movies'), join(state.media, 'TV'), '/nowhere/at/all'],
        },
      })
      expect(update.statusCode).toBe(200)
      await settle(library.id)
      const current = expectShape({
        response: await app().inject({ method: 'GET', url: `/api/libraries/${library.id}` }),
        guard: isLibrary,
      })
      expect(current.scan.error).toBe('Could not read /nowhere/at/all.')
      expect(current.itemCount).toBe(2)
    })

    describe('favourites', () => {
      const favourites = async (): Promise<MediaItem[]> =>
        expectShape({
          response: await app().inject({ method: 'GET', url: '/api/favourites' }),
          guard: isMediaList,
        })
      const mark = async ({ id, favourite }: { id: number; favourite: boolean }) =>
        app().inject({ method: 'PUT', url: `/api/media/${id}/favourite`, payload: { favourite } })

      it('marks a video as a favourite and lists it', async () => {
        const [movie] = await listMedia(library.id)
        const marked = expectShape({
          response: await mark({ id: movie?.id ?? -1, favourite: true }),
          guard: isMediaItem,
        })
        expect(marked.favourite).toBe(true)
        expect((await favourites()).map((item) => item.id)).toEqual([movie?.id])
        expect((await listMedia(library.id))[0]?.favourite).toBe(true)
      })

      it('lists the most recently marked first, and forgets one that is unmarked', async () => {
        const [movie, episode] = await listMedia(library.id)
        await mark({ id: episode?.id ?? -1, favourite: true })
        expect((await favourites()).map((item) => item.title)).toEqual([
          'Show - S01E01',
          'Big Buck Test 2008',
        ])
        const unmarked = expectShape({
          response: await mark({ id: movie?.id ?? -1, favourite: false }),
          guard: isMediaItem,
        })
        expect(unmarked.favourite).toBe(false)
        expect((await favourites()).map((item) => item.id)).toEqual([episode?.id])
      })

      it('rejects a flag that is not a boolean', async () => {
        const [movie] = await listMedia(library.id)
        const response = await app().inject({
          method: 'PUT',
          url: `/api/media/${movie?.id}/favourite`,
          payload: { favourite: 'yes' },
        })
        expect(response.statusCode).toBe(400)
        expect(
          (
            await app().inject({
              method: 'PUT',
              url: '/api/media/999999/favourite',
              payload: { favourite: true },
            })
          ).statusCode,
        ).toBe(404)
      })
    })

    describe('history', () => {
      const history = async (query = ''): Promise<HistoryEntry[]> =>
        expectShape({
          response: await app().inject({
            method: 'GET',
            url: `/api/libraries/${library.id}/history${query}`,
          }),
          guard: isHistory,
        })
      const entryFor = async ({ id, query }: { id: number; query?: string }) =>
        (await history(query)).find((entry) => entry.media.id === id)

      it('records a play, and lists it as watched once playback gets far enough', async () => {
        const [, episode] = await listMedia(library.id)
        const id = episode?.id ?? -1
        const played = await app().inject({ method: 'POST', url: `/api/media/${id}/plays` })
        expect(played.statusCode).toBe(204)
        expect(await entryFor({ id })).toMatchObject({ plays: 1, furthest: 0, watched: false })
        expect(await entryFor({ id, query: '?watched=true' })).toBeUndefined()

        await app().inject({
          method: 'PUT',
          url: `/api/media/${id}/progress`,
          payload: { position: episode?.duration ?? 0 },
        })
        expect(await entryFor({ id, query: '?watched=true' })).toMatchObject({
          plays: 1,
          watched: true,
        })
      })

      it('keeps to the limit it is asked for', async () => {
        expect(await history('?limit=1')).toHaveLength(1)
      })

      it('says when the video or the library is not there', async () => {
        const play = await app().inject({ method: 'POST', url: '/api/media/999999/plays' })
        expect(play.statusCode).toBe(404)
        const list = await app().inject({ method: 'GET', url: '/api/libraries/999999/history' })
        expect(list.statusCode).toBe(404)
      })
    })

    describe('deleting a video', () => {
      const indexed = async (title: string): Promise<MediaItem> => {
        await app().inject({ method: 'POST', url: `/api/libraries/${library.id}/scan` })
        await settle(library.id)
        const item = (await listMedia(library.id)).find((entry) => entry.title === title)
        if (!item) throw new Error(`${title} was not indexed`)
        return item
      }

      it('removes the file from disk along with its row, thumbnail and favourite', async () => {
        const path = join(state.media, 'Movies', 'Doomed.mp4')
        await encodeClip({ path, seconds: 2 })
        const doomed = await indexed('Doomed')
        await app().inject({
          method: 'PUT',
          url: `/api/media/${doomed.id}/favourite`,
          payload: { favourite: true },
        })
        const thumbnail = app().get(ThumbnailService).pathFor(doomed.id)
        await expect(stat(thumbnail)).resolves.toBeTruthy()

        const response = await app().inject({ method: 'DELETE', url: `/api/media/${doomed.id}` })
        expect(response.statusCode).toBe(204)
        await expect(stat(path)).rejects.toThrow()
        await expect(stat(thumbnail)).rejects.toThrow()
        expect(
          (await app().inject({ method: 'GET', url: `/api/media/${doomed.id}` })).statusCode,
        ).toBe(404)
        expect(
          (await app().inject({ method: 'DELETE', url: `/api/media/${doomed.id}` })).statusCode,
        ).toBe(404)
        const listed = expectShape({
          response: await app().inject({ method: 'GET', url: '/api/favourites' }),
          guard: isMediaList,
        })
        expect(listed.map((item) => item.id)).not.toContain(doomed.id)
        const current = expectShape({
          response: await app().inject({ method: 'GET', url: `/api/libraries/${library.id}` }),
          guard: isLibrary,
        })
        expect(current.itemCount).toBe(2)
      })

      it('drops the row when the file is already gone', async () => {
        const path = join(state.media, 'Movies', 'Vanished.mp4')
        await encodeClip({ path, seconds: 2 })
        const vanished = await indexed('Vanished')
        await rm(path)
        const response = await app().inject({ method: 'DELETE', url: `/api/media/${vanished.id}` })
        expect(response.statusCode).toBe(204)
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
            const response = await app().inject({ method: 'DELETE', url: `/api/media/${kept.id}` })
            expect(response.statusCode).toBe(500)
            expect(response.json()).toMatchObject({
              message: expect.stringContaining('Could not delete the file'),
            })
            await expect(stat(path)).resolves.toBeTruthy()
            expect(
              (await app().inject({ method: 'GET', url: `/api/media/${kept.id}` })).statusCode,
            ).toBe(200)
          } finally {
            await chmod(locked, 0o755)
          }
          // Writable again, the same request goes through.
          const retry = await app().inject({ method: 'DELETE', url: `/api/media/${kept.id}` })
          expect(retry.statusCode).toBe(204)
          await rm(locked, { recursive: true, force: true })
        },
      )
    })
  })

  describe('folder browser', () => {
    it('lists folders under the browse root, hiding dot folders', async () => {
      const listing = expectShape({
        response: await app().inject({
          method: 'GET',
          url: `/api/fs/browse?path=${encodeURIComponent(join(state.media, 'Movies'))}`,
        }),
        guard: isDirectoryListing,
      })
      expect(listing.directories).toEqual([])
      const top = expectShape({
        response: await app().inject({ method: 'GET', url: '/api/fs/browse' }),
        guard: isDirectoryListing,
      })
      expect(top.parent).toBeNull()
      expect(top.directories.map((entry) => entry.name)).toEqual(['Movies', 'TV'])
    })

    it('refuses to leave the browse root', async () => {
      const response = await app().inject({
        method: 'GET',
        url: `/api/fs/browse?path=${encodeURIComponent(state.root)}`,
      })
      expect(response.statusCode).toBe(400)
    })
  })

  it('deletes a library with its media and thumbnails', async () => {
    const [created] = expectShape({
      response: await app().inject({ method: 'GET', url: '/api/libraries' }),
      guard: isLibraryList,
    })
    const response = await app().inject({ method: 'DELETE', url: `/api/libraries/${created?.id}` })
    expect(response.statusCode).toBe(204)
    expect(
      (await app().inject({ method: 'GET', url: `/api/libraries/${created?.id}` })).statusCode,
    ).toBe(404)
  })
})

describe('refreshing a library as its folders change', () => {
  const state = {
    root: '',
    media: '',
    libraryId: 0,
    app: null as NestFastifyApplication | null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const at = (...parts: string[]) => join(state.media, ...parts)
  const listMedia = async (): Promise<MediaItem[]> =>
    expectShape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.libraryId}/media?sort=changed`,
      }),
      guard: isMediaList,
    })
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
    const created = expectShape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'Watched', paths: [state.media] },
      }),
      guard: isLibrary,
    })
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
    await app().inject({
      method: 'PUT',
      url: `/api/media/${before?.id}/favourite`,
      payload: { favourite: true },
    })
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
    const response = await fetch(`${await app().getUrl()}/api/events`, { signal: abort.signal })
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
    await app().inject({
      method: 'PUT',
      url: `/api/libraries/${state.libraryId}`,
      payload: { name: 'Watched', paths: [state.media], settings: { autoRefresh: false } },
    })
    const before = fileNames(await listMedia())
    await copyFile(at('Heat (1995) 1080p.mp4'), at('Unwatched.mp4'))
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(fileNames(await listMedia())).toEqual(before)
  })
})

describe('a library locked behind the PIN', () => {
  const state = {
    root: '',
    open: 0,
    private: 0,
    privateVideo: 0,
    privateItem: 0,
    app: null as NestFastifyApplication | null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)
  const get = (url: string, cookie?: string) =>
    app().inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
  const unlock = async (pin: string) => {
    const response = await app().inject({
      method: 'POST',
      url: '/api/lock/unlock',
      payload: { pin },
    })
    const header = response.headers['set-cookie']
    return { response, cookie: typeof header === 'string' ? (header.split(';')[0] ?? '') : '' }
  }
  const createLibrary = async (payload: Record<string, unknown>): Promise<number> => {
    const created = expectShape({
      response: await app().inject({ method: 'POST', url: '/api/libraries', payload }),
      guard: isLibrary,
    })
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
    state.open = await createLibrary({ name: 'Open', paths: [at('Open')] })
    state.private = await createLibrary({
      name: 'Tutorials',
      paths: [at('Private')],
      settings: { locked: true },
    })
    const [video] = app().get(MediaRepository).list({ libraryId: state.private })
    state.privateVideo = video?.id ?? 0
    // A movie only the locked library holds, as if it had been matched.
    const metadata = app().get(MetadataRepository)
    state.privateItem = metadata.save({
      item: {
        type: 'movie',
        tmdbId: '7001',
        number: null,
        title: 'Lesson One',
        originalTitle: null,
        year: null,
        released: null,
        ended: null,
        summary: null,
        tagline: null,
        contentRating: null,
        runtime: null,
        studio: null,
        genres: [],
        imdbId: null,
        tvdbId: null,
        images: { poster: null, backdrop: null, still: null },
        credits: [],
        rating: null,
        reviews: [],
      },
    })
    metadata.link({ mediaIds: [state.privateVideo], itemIds: [state.privateItem] })
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('lists the library, saying it is locked', async () => {
    const libraries = expectShape({ response: await get('/api/libraries'), guard: isLibraryList })
    expect(libraries.map((library) => [library.name, library.settings.locked])).toEqual([
      ['Open', false],
      ['Tutorials', true],
    ])
    expect(expectShape({ response: await get('/api/lock'), guard: isLockState })).toEqual({
      available: true,
      unlocked: false,
    })
  })

  it('holds back its videos, their files, pictures and paths, and its history', async () => {
    const id = state.privateVideo
    const urls = [
      `/api/libraries/${state.private}/media`,
      `/api/libraries/${state.private}/history`,
      `/api/media/${id}`,
      `/api/media/${id}/file`,
      `/api/media/${id}/thumbnail`,
      `/api/media/${id}/location`,
      `/api/media/${id}/tracks`,
      `/api/media/${id}/stream?mode=remux`,
    ]
    const statuses = await Promise.all(urls.map(async (url) => (await get(url)).statusCode))
    expect(statuses).toEqual(urls.map(() => 423))
    expect((await get(`/api/libraries/${state.open}/media`)).statusCode).toBe(200)
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
        const response = await app().inject({ method, url })
        return `${method} ${url} ${response.statusCode}`
      }),
    )
    expect(answers).toEqual(held.map(({ method, url }) => `${method} ${url} 423`))
  })

  it('opens with the PIN, and shuts again when locked', async () => {
    const wrong = await unlock('1234')
    expect(wrong.response.statusCode).toBe(401)
    const { response, cookie } = await unlock('3001')
    expect(response.statusCode).toBe(200)
    expect(response.headers['set-cookie']).toContain('HttpOnly')
    expect((await get(`/api/libraries/${state.private}/media`, cookie)).statusCode).toBe(200)
    expect(expectShape({ response: await get('/api/lock', cookie), guard: isLockState })).toEqual({
      available: true,
      unlocked: true,
    })

    await app().inject({
      method: 'PUT',
      url: `/api/media/${state.privateVideo}/favourite`,
      payload: { favourite: true },
      headers: { cookie },
    })
    const favourites = async (with_: string | undefined) =>
      expectShape({ response: await get('/api/favourites', with_), guard: isMediaList }).map(
        (item) => item.id,
      )
    expect(await favourites(cookie)).toEqual([state.privateVideo])
    expect(await favourites(undefined)).toEqual([])

    const locked = await app().inject({ method: 'POST', url: '/api/lock/lock' })
    expect(locked.headers['set-cookie']).toContain('Max-Age=0')
    expect(
      (await get(`/api/libraries/${state.private}/media`, 'raven_unlock=1.forged')).statusCode,
    ).toBe(423)
  })

  it('waits a minute after five wrong PINs in a row', async () => {
    const statuses = await Array.from({ length: 6 }).reduce<Promise<number[]>>(
      async (done) => [...(await done), (await unlock('0000')).response.statusCode],
      Promise.resolve([]),
    )
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    expect((await unlock('3001')).response.statusCode).toBe(429)
  })
})

describe('a library whose folders cannot be watched', () => {
  const state = {
    root: '',
    libraryId: 0,
    app: null as NestFastifyApplication | null,
    /** Every watch asked for, and whether it should fail. */
    watches: [] as string[],
    failing: true,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const media = () => join(state.root, 'media')
  const listMedia = async (): Promise<MediaItem[]> =>
    expectShape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.libraryId}/media`,
      }),
      guard: isMediaList,
    })

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
    const created = expectShape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'Unwatched', paths: [media()] },
      }),
      guard: isLibrary,
    })
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
    await app().inject({
      method: 'PUT',
      url: `/api/libraries/${state.libraryId}`,
      payload: { name: 'Unwatched again', paths: [media()] },
    })
    expect(state.watches.length).toBe(before + 1)
  })
})

describe('serving the web app', () => {
  const state = { root: '', app: null as NestFastifyApplication | null }

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
    const response = await state.app!.inject({ method: 'GET', url: '/library/3' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<title>raven</title>')
  })

  it('caches fingerprinted assets for good', async () => {
    const response = await state.app!.inject({ method: 'GET', url: '/assets/app-1234.js' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('immutable')
  })

  it('keeps API 404s as JSON', async () => {
    const response = await state.app!.inject({ method: 'GET', url: '/api/media/999' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ statusCode: 404 })
  })
})
