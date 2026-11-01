import { HEADERS } from '@shared/server'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  AUDIO_BITRATES,
  type ApiClient,
  LIBRARY_KINDS,
  type LibraryInput,
  groupingsFor,
  isLibraryKind,
  isRecord,
  LYRICS_KINDS,
  musicListQuery,
  sortsFor,
  viewsFor,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AUDIENCES } from '@/admin/adminGuard'
import { createApp } from '@/app'
import { AUTH_PATHS } from '@raven/core'
import { CONTROLLERS } from '@/appModule'
import { HIDDEN_SCAN_ERROR, LOCKED_SCAN_ERROR } from '@/libraries/librariesController'
import { LOCK_MARKS } from '@/lock/lockGuard'
import type { Privacy } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { BLANK_ITEM } from '@/metadata/tmdbShapes'
import { routeMarks } from '@/routeMarks'
import { ScannerService } from '@/scanner/scannerService'
import {
  ADMIN_PASSWORD,
  NOT_WATCHING,
  ROUTE_METHODS,
  type RouteMethod,
  adminCookie,
  cookieSet,
  cookies,
  isRouteMethod,
  testConfig,
} from '@/test/app'
import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { MusicRepository } from '@/music/musicRepository'
import { encodeClip, encodeTrack } from '@/test/clips'
import { fakeLrclib } from '@/test/fakeLrclib'
import { fakeTmdb } from '@/test/fakeTmdb'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/** As a browser with the admin lock off, the one place the PIN opens anything. */
describe('a library locked behind the PIN', () => {
  const state: {
    root: string
    admin: string
    open: number
    private: number
    privateVideo: number
    privateItem: number
    privateMusic: number
    privateAlbum: number
    app: NestFastifyApplication | null
  } = {
    root: '',
    admin: '',
    open: 0,
    private: 0,
    privateVideo: 0,
    privateItem: 0,
    privateMusic: 0,
    privateAlbum: 0,
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** The client as a browser holding `cookie`, or none, beside its admin session. */
  const api = (cookie?: string): ApiClient =>
    apiFor({ app: app(), cookie: cookies(state.admin, cookie) })
  type InjectProps = { method: RouteMethod; url: string }

  /** A request by hand from the same browser. */
  const inject = ({ method, url }: InjectProps) =>
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
    await encodeTrack({
      path: at('Private', 'Music', 'Lesson One (Audio).mp3'),
      tags: { title: 'Lesson One', artist: 'Tutor', album: 'Lessons' },
    })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        libraryPin: '3001',
      },
      quiet: true,
      watch: NOT_WATCHING,
      // LRCLIB, and MusicBrainz with it, knowing nothing, so the lyrics route asks no network.
      metadataFetch: fakeLrclib({ records: [] }).fetch,
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
    // A locked music library too, so the album routes have an album to hold back.
    state.privateMusic = await createLibrary({
      name: 'Lessons',
      paths: [at('Private', 'Music')],
      settings: { kind: LIBRARY_KINDS.music, locked: true },
    })
    state.privateAlbum =
      app()
        .get(MusicRepository)
        .listAlbums({
          libraryId: state.privateMusic,
          ...musicListQuery.decode({}),
          account: VIEWING_ACCOUNTS.local,
        })[0]?.id ?? 0
    // A movie only the locked library holds, as if it had been matched.
    const metadata = app().get(MetadataRepository)
    state.privateItem = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: '7001', number: null, title: 'Lesson One' },
    })
    metadata.link({ mediaIds: [state.privateVideo], itemIds: [state.privateItem] })
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('lists the library, saying it is locked', async () => {
    const libraries = await api().listLibraries()
    expect(libraries.map((library) => [library.name, library.settings.locked])).toEqual([
      ['Lessons', true],
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
        layouts: library.layouts,
        backdrop: library.backdrop?.type ?? null,
      }))
    expect(await shown()).toEqual([
      { paths: [], layouts: [], backdrop: null },
      { paths: [at('Open')], layouts: expect.any(Array), backdrop: 'thumbnail' },
      { paths: [], layouts: [], backdrop: null },
    ])
    expect(await api().getLibrary(state.private)).toMatchObject({
      paths: [],
      layouts: [],
      backdrop: null,
    })
    const { cookie } = await unlock('3001')
    expect(await shown(cookie)).toEqual([
      // A music library grabs no frames, so it has no picture yet.
      { paths: [at('Private', 'Music')], layouts: expect.any(Array), backdrop: null },
      { paths: [at('Open')], layouts: expect.any(Array), backdrop: 'thumbnail' },
      { paths: [at('Private')], layouts: expect.any(Array), backdrop: 'thumbnail' },
    ])
    expect((await api(cookie).getLibrary(state.private)).backdrop).toEqual({
      type: 'thumbnail',
      id: state.privateVideo,
      version: expect.any(Number),
    })
  })

  it("says where a locked library's Update ratings stands while keeping the rest to itself", async () => {
    const { cookie } = await unlock('3001')
    const refreshed = await api(cookie).updateLibraryRatings(state.private)
    await app().get(ScannerService).whenIdle(state.private)
    await app().get(MetadataService).whenIdle()

    const shown = await api().getLibrary(state.private)

    expect(shown).toMatchObject({ paths: [], layouts: [], backdrop: null })
    // Nothing could answer this server's Refresh, so it finished at once.
    expect(refreshed.ratingsRefresh).toEqual({ state: 'idle', finishedAt: expect.any(String) })
    expect(shown.ratingsRefresh).toEqual(refreshed.ratingsRefresh)
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
        api().fileUrl({ id }),
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
      album: state.privateAlbum,
    }
    const held = routeMarks(CONTROLLERS).flatMap((route) => {
      if (route.lock == null || route.lock === LOCK_MARKS.public || !isRouteMethod(route.method))
        return []
      return [
        {
          method: route.method,
          url: route.path.replace(':id', String(ids[route.lock])).replace(/:\w+/g, 'poster'),
          expectedStatus: route.path === AUTH_PATHS.ticket ? 503 : 423,
        },
      ]
    })
    expect(routeMarks(CONTROLLERS).every((route) => isRouteMethod(route.method))).toBe(true)
    expect(held.length).toBeGreaterThan(25)
    const answers = await Promise.all(
      held.map(async ({ method, url }) => {
        const response = await inject({ method, url })
        return `${method} ${url} ${response.statusCode}`
      }),
    )
    expect(answers).toEqual(
      held.map(({ method, url, expectedStatus }) => `${method} ${url} ${expectedStatus}`),
    )
  })

  it('opens with the PIN, and shuts again when locked', async () => {
    await expect(api().unlock('1234')).rejects.toMatchObject({ status: 401 })
    const { response, cookie } = await unlock('3001')
    expect(response.statusCode).toBe(200)
    expect(response.headers[HEADERS.setCookie]).toContain('HttpOnly')
    await expect(api(cookie).listMedia({ libraryId: state.private })).resolves.toHaveLength(1)
    expect(await api(cookie).getLock()).toEqual({ available: true, unlocked: true })

    // A locked library's videos are never favourites, even with the PIN entered.
    await expect(
      api(cookie).setFavourite({ id: state.privateVideo, favourite: true }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await api(cookie).listFavourites()).toEqual([])

    // The cookie that forgets the session is only in the response's headers.
    const locked = await app().inject({ method: 'POST', url: '/api/lock/lock' })
    expect(locked.headers[HEADERS.setCookie]).toContain('Max-Age=0')
    await expect(
      api('raven_unlock=1.forged').listMedia({ libraryId: state.private }),
    ).rejects.toMatchObject({ status: 423 })
  })

  it("leaves a locked library's tracks out of a playlist, and its lyrics behind the PIN", async () => {
    const [track] = app().get(MediaIndex).idsForLibrary(state.privateMusic)
    const id = track ?? 0
    const { playlist } = await api().createPlaylist({ name: 'Lessons' })
    // The admin can enter the PIN, so the lock says so rather than hiding the track.
    await expect(
      api().appendPlaylistTracks({ id: playlist.id, mediaIds: [id] }),
    ).rejects.toMatchObject({ status: 423 })
    await expect(api().getLyrics(id)).rejects.toMatchObject({ status: 423 })
    const transcode = api().transcodeUrl({
      mediaId: id,
      kbps: AUDIO_BITRATES.standard,
    })
    expect((await inject({ method: 'GET', url: transcode })).statusCode).toBe(423)
    // A video is no track, locked or not.
    await expect(
      api().appendPlaylistTracks({ id: playlist.id, mediaIds: [state.privateVideo] }),
    ).rejects.toMatchObject({ status: 404 })

    const { cookie } = await unlock('3001')
    const added = await api(cookie).appendPlaylistTracks({ id: playlist.id, mediaIds: [id] })
    expect(added.tracks.map((each) => each.id)).toEqual([id])
    expect((await api(cookie).getLyrics(id)).kind).toBe(LYRICS_KINDS.none)

    // Without the PIN the playlist holds nothing to see, and a new order keeps what it hides.
    const shut = await api().getPlaylist(playlist.id)
    expect(shut.tracks).toEqual([])
    expect(shut.playlist.trackCount).toBe(0)
    expect((await api().listPlaylists())[0]?.trackCount ?? null).toBe(0)
    await api().replacePlaylistTracks({ id: playlist.id, mediaIds: [] })
    expect((await api(cookie).getPlaylist(playlist.id)).tracks.map((each) => each.id)).toEqual([id])
    await api().deletePlaylist(playlist.id)
  })

  it('keeps a locked library off the home page until it is unlocked', async () => {
    const { cookie } = await unlock('3001')
    await api(cookie).saveProgress({ id: state.privateVideo, position: 1, audio: null })
    const home = async (holding?: string) => {
      const answer = await api(holding).getHome()
      return {
        inProgress: answer.inProgress.map((entry) => entry.media.id),
        shelves: answer.shelves.map((shelf) => shelf.libraryId),
      }
    }
    expect(await home(cookie)).toEqual({
      inProgress: [state.privateVideo],
      shelves: [state.privateMusic, state.open, state.private],
    })
    expect(await home()).toEqual({ inProgress: [], shelves: [state.open] })
  })

  it('keeps a locked library out of a search from home, even once it is unlocked', async () => {
    const { cookie } = await unlock('3001')
    const found = async (holding?: string) =>
      (await api(holding).searchHome('e')).map((shelf) => shelf.libraryId)
    expect(await found(cookie)).toEqual([state.open])
    expect(await found()).toEqual([state.open])
  })

  it('stays locked whatever its type', async () => {
    const { cookie } = await unlock('3001')
    const { name, paths } = await api(cookie).getLibrary(state.private)
    const answers = await isLibraryKind.values.reduce<Promise<string[]>>(async (done, kind) => {
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
    expect(answers).toEqual(isLibraryKind.values.map((kind) => `${kind} locked=true 423`))
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

/** A title only a locked library holds is on raven for a person's page only once the PIN opens it. */
describe("a person's filmography beside a locked library", () => {
  const tmdb = fakeTmdb({ movies: [{ id: 603, title: 'The Matrix', released: '1999-03-31' }] })
  const state: {
    root: string
    admin: string
    pin: string
    matrix: number
    keanu: number
    app: NestFastifyApplication | null
  } = { root: '', admin: '', pin: '', matrix: 0, keanu: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-locked-people-'))
    await encodeClip({ path: at('Private', 'The Matrix (1999).mp4'), seconds: 1 })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        libraryPin: '3001',
        tmdbApiToken: 'test-token',
      },
      quiet: true,
      watch: NOT_WATCHING,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const library = await apiFor({ app: app(), cookie: state.admin }).createLibrary({
      name: 'Films',
      paths: [at('Private')],
      settings: { kind: 'movies', locked: true },
    })
    await app().get(ScannerService).whenIdle(library.id)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
    const metadata = app().get(MetadataRepository)
    state.matrix = metadata.find({ type: 'movie', tmdbId: '603' })?.id ?? 0
    state.keanu =
      metadata.credits(state.matrix).find((credit) => credit.name === 'Keanu Reeves')?.personId ?? 0
    state.pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('asks TMDB only for a browser that finds them in raven, and names the item only for one the PIN opened the library for', async () => {
    const pageFor = async (...cookie: string[]) => {
      const person = await apiFor({ app: app(), cookie: cookies(...cookie) }).getPerson(state.keanu)
      return {
        state: person.filmography.state,
        matrix:
          person.filmography.state === 'ready'
            ? (person.filmography.entries.find((entry) => entry.tmdbId === '603')?.item ?? null)
            : null,
        credits: person.credits.map((credit) => credit.item.id),
      }
    }
    // Keanu's one title is out of this browser's sight, so TMDB is not asked about him.
    expect(await pageFor(state.admin)).toEqual({ state: 'unavailable', matrix: null, credits: [] })
    expect(tmdb.state.personCalls).toBe(0)

    expect(await pageFor(state.admin, state.pin)).toEqual({
      state: 'ready',
      matrix: expect.objectContaining({ id: state.matrix, title: 'The Matrix' }),
      credits: [state.matrix],
    })
    expect(tmdb.state.personCalls).toBe(1)
    expect(await pageFor(state.admin)).toEqual({ state: 'ready', matrix: null, credits: [] })
    // While the admin lock holds, the PIN opens nothing.
    expect(await pageFor(state.pin)).toEqual({ state: 'ready', matrix: null, credits: [] })
  })
})

describe('the admin lock', () => {
  const state: {
    root: string
    admin: string
    pin: string
    open: number
    openVideo: number
    openItem: number
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
    openItem: 0,
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
  type PostProps = { path: string; cookie: string }

  /** A POST to the admin lock by hand, for the cookie its answer sets. */
  const post = async ({ path, cookie }: PostProps) => {
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
    await encodeTrack({
      path: at('Private', 'Music', 'Lesson One (Audio).mp3'),
      tags: { title: 'Lesson One', artist: 'Tutor', album: 'Lessons' },
    })
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
    state.openItem = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: '7004', number: null, title: 'Heat' },
    })
    metadata.link({ mediaIds: [state.openVideo], itemIds: [state.openItem] })
    state.pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
  })

  afterAll(async () => {
    vi.useRealTimers()
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
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

  it('hides an item no library holds while a library is locked', async () => {
    // As a pass TMDB stopped after a type change leaves an item, which may be a locked library's.
    const orphan = app()
      .get(MetadataRepository)
      .save({
        item: { ...BLANK_ITEM, type: 'movie', tmdbId: '7003', number: null, title: 'Left Over' },
      })
    expect(await status(api().getItem(orphan))).toBe(404)
    expect(await status(api(state.admin, state.pin).getItem(orphan))).toBe(200)
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
      message: 'The admin lock is on. Turn it off in Admin to do this.',
    })
    expect(
      await status(
        api().createLibrary({ name: 'Secret', paths: [at('Open')], settings: { locked: true } }),
      ),
    ).toBe(403)
    // Saving how an open library is laid out is fine.
    const saved = await api().setLibraryView({ id: state.open, change: { pinned: false } })
    expect(saved.settings).toMatchObject({ pinned: false, locked: false })
  })

  it('holds back every route marked AdminOnly, until the password is entered', async () => {
    // Ids that name nothing pass the PIN lock, and leave a route nothing to change. An item no
    // library holds is hidden while a library is locked, so an item's routes take the open
    // movie: sent no body, and with TMDB off, none of them changes it.
    const absent = 999999
    const ids: Record<Privacy, number> = {
      library: absent,
      media: absent,
      item: state.openItem,
      album: absent,
    }
    const managing = routeMarks(CONTROLLERS).flatMap(({ method, path, lock, audience }) => {
      if (audience !== AUDIENCES.admin || !isRouteMethod(method)) return []
      const id = lock == null || lock === LOCK_MARKS.public ? absent : ids[lock]
      return [{ method, url: path.replace(':id', String(id)).replace(/:\w+/g, 'poster') }]
    })
    expect(managing.length).toBeGreaterThanOrEqual(17)
    const answers = (cookie?: string) =>
      Promise.all(
        managing.map(async ({ method, url }) => {
          const response = await app().inject({ method, url, headers: { cookie: cookies(cookie) } })
          return { route: `${method} ${url}`, method, code: response.statusCode }
        }),
      )
    expect((await answers()).map(({ route, code }) => `${route} ${code}`)).toEqual(
      managing.map(({ method, url }) => `${method} ${url} 403`),
    )
    const admitted = await answers(state.admin)
    expect(admitted.filter(({ code }) => code === 403).map(({ route }) => route)).toEqual([])
    expect(
      admitted
        .filter(({ method, code }) => method !== ROUTE_METHODS.get && code < 400)
        .map(({ route }) => route),
    ).toEqual([])
  })

  it('lets anyone sort, view, group or pin a library, and change nothing else of it', async () => {
    const before = await api(state.admin).getLibrary(state.open)
    const { kind, sort, view, groupBy, pinned } = before.settings
    type AnotherProps<T> = { values: readonly T[]; current: T }

    const another = <T>({ values, current }: AnotherProps<T>): T =>
      values.find((value) => value !== current) ?? current
    const change = {
      sort: another({ values: sortsFor(kind), current: sort }),
      view: another({ values: viewsFor(kind), current: view }),
      groupBy: another({ values: groupingsFor(kind), current: groupBy }),
      pinned: !pinned,
    }
    const viewed = await api().setLibraryView({ id: state.open, change })
    expect(viewed.settings).toEqual({ ...before.settings, ...change })

    const others = [{ name: 'Renamed' }, { sort, kind: 'movies' }, { locked: true }]
    const refused = await Promise.all(
      others.map(async (payload) => {
        const response = await app().inject({
          method: 'PUT',
          url: `/api/libraries/${state.open}/view`,
          payload,
        })
        return response.statusCode
      }),
    )
    expect(refused).toEqual([400, 400, 400])
    expect(await api(state.admin).getLibrary(state.open)).toMatchObject({
      name: before.name,
      paths: before.paths,
      settings: { ...before.settings, ...change },
    })
  })

  it("says an open library's scan failed without naming its folders while the lock is on", async () => {
    const created = await api(state.admin).createLibrary({
      name: 'Gone',
      paths: [at('Missing')],
    })
    await app().get(ScannerService).whenIdle(created.id)
    try {
      expect((await api().getLibrary(created.id)).scan.error).toBe(HIDDEN_SCAN_ERROR)
      expect((await api(state.admin).getLibrary(created.id)).scan.error).toContain(at('Missing'))
    } finally {
      await api(state.admin).deleteLibrary(created.id)
    }
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
    expect(response.headers[HEADERS.setCookie]).toContain('HttpOnly')
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
