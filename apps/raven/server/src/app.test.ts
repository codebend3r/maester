import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { type ServerConfig, readServerConfig } from '@/config'
import { MediaRepository } from '@/media/mediaRepository'
import { TracksService } from '@/playback/tracksService'
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
    await app().get(TracksService).whenIdle()
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
        })
      })

      it('changes what type of library it is after it was made', async () => {
        expect((await putLibrary({ kind: 'shows' })).settings.kind).toBe('shows')
        const current = expectShape({
          response: await app().inject({ method: 'GET', url: `/api/libraries/${library.id}` }),
          guard: isLibrary,
        })
        expect(current.settings.kind).toBe('shows')
        expect((await putLibrary({ kind: 'other' })).settings.kind).toBe('other')
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
          .get(MediaRepository)
          .storedTracks(movie?.id ?? -1)?.audio,
      ).toHaveLength(1)
    })

    it('fills in tracks a video indexed before they were stored is missing, on the next scan', async () => {
      const [movie] = await listMedia(library.id)
      const id = movie?.id ?? -1
      app().get(MediaRepository).forgetTracks(id)
      expect(app().get(MediaRepository).storedTracks(id)).toBeNull()
      await app().inject({ method: 'POST', url: `/api/libraries/${library.id}/scan` })
      await settle(library.id)
      expect(app().get(MediaRepository).storedTracks(id)?.audio).toHaveLength(1)
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
