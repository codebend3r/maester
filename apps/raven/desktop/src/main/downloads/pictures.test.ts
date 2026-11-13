import { DOWNLOAD_KINDS, DOWNLOAD_STATUS_KINDS, ITEM_TYPES, type Library } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  PICTURE_EXTENSIONS,
  type DownloadEntry,
  type DownloadsState,
  type EntryPictures,
  type SavedPicture,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { createDownloadPictures, PICTURE_MAX_BYTES } from '@/main/downloads/pictures'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { fakeDisk, whole } from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'
import {
  albumDetails,
  details,
  fakeCalls,
  keyOf,
  library,
  ok,
  type Reply,
  summary,
} from '@/main/test/serverFakes'
import { mediaItemFor } from '@/shared/test/mediaItem'
import { HEADERS } from '@shared/http'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const SERVER = { id: SERVER_ID, origin: 'https://raven.example', name: 'Vhagar' }
const USER_DATA = '/data'
const PICTURES = `/data/downloads/${SERVER_ID}/pictures`
const SHOW_ID = 4
const POSTER_PATH = `/api/pictures/items/${SHOW_ID}/poster/p1`
const LOGO_PATH = `/api/pictures/items/${SHOW_ID}/logo/l1`
const COVER_PATH = '/api/pictures/albums/7/c1'

const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const pictureIdOf = (n: number): string => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const MOVIES = { id: 1, name: 'Library', isPrivate: false }

/** An episode of the show as a `downloads.json` from before libraries and pictures holds it. */
const entryFromBefore = (n: number): DownloadEntry => ({
  downloadId: idOf(n),
  serverId: SERVER_ID,
  mediaId: n,
  label: `Episode ${n}`,
  group: { kind: DOWNLOAD_KINDS.season, key: `show:${SHOW_ID}`, title: 'Severance', order: n },
  container: 'mkv',
  size: 8,
  duration: 3000,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: DOWNLOAD_STATUS_KINDS.ready },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: 1,
  track: undefined,
})

type EpisodeForProps = { n: number; overrides?: Partial<DownloadEntry> }

/** The episode filed under its library and its show, as a confirmation files it. */
const episodeFor = ({ n, overrides = {} }: EpisodeForProps): DownloadEntry => ({
  ...entryFromBefore(n),
  library: MOVIES,
  titleItemId: SHOW_ID,
  ...overrides,
})

const trackFor = (n: number): DownloadEntry =>
  episodeFor({
    n,
    overrides: {
      container: 'flac',
      group: {
        kind: DOWNLOAD_KINDS.album,
        key: 'album:7',
        title: 'OK Computer',
        order: n,
        cover: { albumId: 7, coverVersion: 'stale' },
        sourceId: 7,
      },
      library: { id: 3, name: 'Music', isPrivate: false },
      titleItemId: null,
    },
  })

const SHOW = details({
  id: SHOW_ID,
  type: ITEM_TYPES.show,
  title: 'Severance',
  posterVersion: 'p1',
  logoVersion: 'l1',
})

const showCall = keyOf({ name: CALL_NAMES.getItem, itemId: SHOW_ID })
const albumCall = keyOf({ name: CALL_NAMES.getAlbum, albumId: 7 })
const mediaCall = (mediaId: number): string => keyOf({ name: CALL_NAMES.getMedia, mediaId })
const libraryCall = (libraryId: number): string => keyOf({ name: CALL_NAMES.getLibrary, libraryId })

const privateLibrary = (): Library => {
  const base = library({ id: 2, watchedPercent: 90 })
  return { ...base, name: 'Home videos', settings: { ...base.settings, locked: true } }
}

type Picture = { status: number; type?: string; bytes?: Uint8Array }

const JPEG = { status: 200, type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }
const PNG = { status: 200, type: 'image/png; charset=binary', bytes: new Uint8Array([4, 5]) }

const memoryStore = (initial: DownloadsState): DownloadsStore => {
  const state = { value: initial }
  return {
    read: () => state.value,
    update: (change) => {
      state.value = change(state.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
}

type SetupProps = {
  entries?: DownloadEntry[]
  replies?: Record<string, Reply>
  /** What the server answers each picture's address; one it has no answer for is a 404. */
  served?: Record<string, Picture>
  disk?: Record<string, number>
  isSignedIn?: boolean
}

const setup = ({
  entries = [],
  replies = {},
  served = {},
  disk = {},
  isSignedIn = true,
}: SetupProps = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries })
  const table: Record<string, Reply> = { ...replies }
  const pictures: Record<string, Picture> = { ...served }
  const { calls, log } = fakeCalls(table)
  const drive = fakeDisk(disk)
  const { timers, pending } = fakeTimers()
  const fetched: string[] = []
  const warnings: string[] = []
  const account = { isSignedIn }
  const ids = { next: 1 }
  const keeper = createDownloadPictures({
    store,
    calls,
    fetch: async ({ url }) => {
      fetched.push(url)
      const picture = pictures[url.replace(SERVER.origin, '')] ?? { status: 404 }
      const named = new Map<string, string>(
        picture.type === undefined ? [] : [[HEADERS.contentType, picture.type]],
      )
      return {
        status: picture.status,
        headers: { get: (name) => named.get(name) ?? null },
        body: picture.bytes === undefined ? null : whole([picture.bytes]),
      }
    },
    server: SERVER,
    isSignedIn: () => account.isSignedIn,
    fs: {
      mkdir: drive.fs.mkdir,
      readdir: drive.fs.readdir,
      rm: drive.fs.rm,
      writeBytes: async ({ path, bytes }) => {
        if (!drive.dirs.has(path.slice(0, path.lastIndexOf('/')))) throw new Error('no folder')
        drive.files.set(path, [bytes])
      },
    },
    userData: USER_DATA,
    timers,
    newId: () => {
      const id = pictureIdOf(ids.next)
      ids.next += 1
      return id
    },
    warn: (message) => warnings.push(message),
  })
  const entryOf = (n: number): DownloadEntry | undefined =>
    store.read().entries.find(({ downloadId }) => downloadId === idOf(n))
  return {
    store,
    table,
    pictures,
    log,
    drive,
    pending,
    fetched,
    warnings,
    account,
    keeper,
    entryOf,
  }
}

const POSTER: SavedPicture = {
  id: pictureIdOf(1),
  folder: 'item-4',
  extension: PICTURE_EXTENSIONS.jpg,
}
const LOGO: SavedPicture = {
  id: pictureIdOf(2),
  folder: 'item-4',
  extension: PICTURE_EXTENSIONS.png,
}

describe('saving pictures', () => {
  it("saves a show's poster and title art once for all its episodes", async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 }), episodeFor({ n: 12 }), episodeFor({ n: 13 })],
      replies: { [showCall]: ok(SHOW) },
      served: { [POSTER_PATH]: JPEG, [LOGO_PATH]: PNG },
    })
    await world.keeper.fill()
    expect(world.log).toEqual([showCall])
    expect(world.fetched).toEqual([
      `${SERVER.origin}${POSTER_PATH}`,
      `${SERVER.origin}${LOGO_PATH}`,
    ])
    const saved: EntryPictures = { art: POSTER, logo: LOGO, isComplete: true }
    expect([11, 12, 13].map((n) => world.entryOf(n)?.pictures ?? null)).toEqual([
      saved,
      saved,
      saved,
    ])
    expect(world.drive.files.get(`${PICTURES}/item-4/${POSTER.id}.jpg`)).toEqual([JPEG.bytes])
    expect(world.drive.files.get(`${PICTURES}/item-4/${LOGO.id}.png`)).toEqual([PNG.bytes])
    expect([...world.drive.files.keys()]).toHaveLength(2)
    expect(world.pending.size).toBe(0)
  })

  it('serves a saved picture by its id alone, and nothing for an id no download holds', async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 })],
      replies: { [showCall]: ok(SHOW) },
      served: { [POSTER_PATH]: JPEG, [LOGO_PATH]: PNG },
    })
    await world.keeper.fill()
    expect(world.keeper.fileOf(POSTER.id)).toEqual({
      path: `${PICTURES}/item-4/${POSTER.id}.jpg`,
      contentType: 'image/jpeg',
    })
    expect(world.keeper.fileOf(LOGO.id)).toEqual({
      path: `${PICTURES}/item-4/${LOGO.id}.png`,
      contentType: 'image/png',
    })
    expect(world.keeper.fileOf(pictureIdOf(9))).toBeNull()
    expect(world.keeper.fileOf('../../downloads.json')).toBeNull()
  })

  it("saves an album's cover at the version the server names now, with no title art", async () => {
    const album = albumDetails([])
    const world = setup({
      entries: [trackFor(101), trackFor(102)],
      replies: { [albumCall]: ok({ ...album, album: { ...album.album, coverVersion: 'c1' } }) },
      served: { [COVER_PATH]: JPEG },
    })
    await world.keeper.fill()
    expect(world.fetched).toEqual([`${SERVER.origin}${COVER_PATH}`])
    const saved: EntryPictures = {
      art: { id: pictureIdOf(1), folder: 'album-7', extension: PICTURE_EXTENSIONS.jpg },
      logo: null,
      isComplete: true,
    }
    expect(world.entryOf(101)?.pictures ?? null).toEqual(saved)
    expect(world.entryOf(102)?.pictures ?? null).toEqual(saved)
  })

  it('settles a title with no poster or title art, and a file with no title, without a fetch', async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 }), episodeFor({ n: 41, overrides: { titleItemId: null } })],
      replies: { [showCall]: ok({ ...SHOW, posterVersion: null, logoVersion: null }) },
    })
    await world.keeper.fill()
    const none: EntryPictures = { art: null, logo: null, isComplete: true }
    expect(world.entryOf(11)?.pictures ?? null).toEqual(none)
    expect(world.entryOf(41)?.pictures ?? null).toEqual(none)
    expect(world.fetched).toEqual([])
    await world.keeper.fill()
    expect(world.log).toEqual([showCall])
  })

  it('keeps what it could save when a picture fails, and asks only for the rest next time', async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 })],
      replies: { [showCall]: ok(SHOW) },
      served: { [POSTER_PATH]: JPEG, [LOGO_PATH]: { status: 503 } },
    })
    await world.keeper.fill()
    expect(world.entryOf(11)?.pictures ?? null).toEqual({
      art: POSTER,
      logo: null,
      isComplete: false,
    })
    expect(world.warnings).toEqual(['Raven kept no picture for item-4: the server answered 503'])
    world.pictures[LOGO_PATH] = PNG
    await world.keeper.fill()
    expect(world.entryOf(11)?.pictures ?? null).toEqual({
      art: POSTER,
      logo: LOGO,
      isComplete: true,
    })
    expect(world.fetched).toEqual([
      `${SERVER.origin}${POSTER_PATH}`,
      `${SERVER.origin}${LOGO_PATH}`,
      `${SERVER.origin}${LOGO_PATH}`,
    ])
  })

  it('keeps no picture that is not an image, is empty or is larger than it keeps', async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 })],
      replies: { [showCall]: ok(SHOW) },
      served: {
        [POSTER_PATH]: { status: 200, type: 'text/html', bytes: new Uint8Array([60]) },
        [LOGO_PATH]: { status: 200, type: 'image/png', bytes: new Uint8Array(0) },
      },
    })
    await world.keeper.fill()
    expect(world.entryOf(11)?.pictures ?? null).toEqual({
      art: null,
      logo: null,
      isComplete: false,
    })
    world.pictures[POSTER_PATH] = {
      status: 200,
      type: 'image/jpeg',
      bytes: new Uint8Array(PICTURE_MAX_BYTES + 1),
    }
    await world.keeper.fill()
    expect(world.entryOf(11)?.pictures ?? null).toEqual({
      art: null,
      logo: null,
      isComplete: false,
    })
    expect(world.drive.files.size).toBe(0)
  })

  it('gives a download that joins a settled title its pictures with nothing asked', async () => {
    const pictures: EntryPictures = { art: POSTER, logo: LOGO, isComplete: true }
    const world = setup({
      entries: [episodeFor({ n: 11, overrides: { pictures } }), episodeFor({ n: 12 })],
    })
    await world.keeper.fill()
    expect(world.entryOf(12)?.pictures ?? null).toEqual(pictures)
    expect(world.log).toEqual([])
    expect(world.fetched).toEqual([])
  })

  it('settles a title the server no longer has, and leaves one it refuses for the next pass', async () => {
    const world = setup({ entries: [episodeFor({ n: 11 })] })
    await world.keeper.fill()
    expect(world.entryOf(11)?.pictures ?? null).toEqual({ art: null, logo: null, isComplete: true })
    const locked = setup({
      entries: [episodeFor({ n: 11 })],
      replies: { [showCall]: { status: 423, body: '' } },
    })
    await locked.keeper.fill()
    expect(locked.entryOf(11)?.pictures ?? null).toBeNull()
  })

  it('asks nothing while the page is signed out, and ends a pass the server does not answer', async () => {
    const world = setup({
      entries: [entryFromBefore(11), entryFromBefore(12)],
      replies: { [mediaCall(11)]: { unreachable: 'Vhagar could not be reached.' } },
      isSignedIn: false,
    })
    await world.keeper.fill()
    expect(world.log).toEqual([])
    world.account.isSignedIn = true
    await world.keeper.fill()
    expect(world.log).toEqual([mediaCall(11)])
    expect(world.entryOf(11)?.library ?? null).toBeNull()
  })

  it('fetches nothing more once disposed', async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 })],
      replies: { [showCall]: ok(SHOW) },
      served: { [POSTER_PATH]: JPEG, [LOGO_PATH]: PNG },
    })
    world.keeper.dispose()
    await world.keeper.fill()
    expect(world.log).toEqual([])
    expect(world.fetched).toEqual([])
  })
})

describe('entries from before', () => {
  it('files each under its library and its title, then saves its pictures', async () => {
    const episode = summary({
      id: 61,
      type: ITEM_TYPES.episode,
      show: { id: SHOW_ID, title: 'Severance' },
    })
    const world = setup({
      entries: [entryFromBefore(11), entryFromBefore(12)],
      replies: {
        [mediaCall(11)]: ok(mediaItemFor({ id: 11, libraryId: 2, item: episode })),
        [mediaCall(12)]: ok(mediaItemFor({ id: 12, libraryId: 2, item: episode })),
        [libraryCall(2)]: ok(privateLibrary()),
        [showCall]: ok(SHOW),
      },
      served: { [POSTER_PATH]: JPEG, [LOGO_PATH]: PNG },
    })
    await world.keeper.fill()
    // The library is read once however many files it holds.
    expect(world.log).toEqual([mediaCall(11), libraryCall(2), mediaCall(12), showCall])
    const filed = { id: 2, name: 'Home videos', isPrivate: true }
    expect(world.entryOf(11)?.library ?? null).toEqual(filed)
    expect(world.entryOf(12)?.library ?? null).toEqual(filed)
    expect(world.entryOf(11)?.titleItemId ?? null).toBe(SHOW_ID)
    expect(world.entryOf(12)?.pictures ?? null).toEqual({
      art: POSTER,
      logo: LOGO,
      isComplete: true,
    })
  })

  it('leaves one the server will not name now as it is, and asks again the next time', async () => {
    const world = setup({
      entries: [entryFromBefore(11), entryFromBefore(12)],
      replies: {
        [mediaCall(11)]: { status: 423, body: '' },
        [mediaCall(12)]: ok(mediaItemFor({ id: 12, libraryId: 1 })),
        [libraryCall(1)]: ok(library({ id: 1, watchedPercent: 90 })),
      },
    })
    await world.keeper.fill()
    expect(world.entryOf(11)?.library ?? null).toBeNull()
    expect(world.entryOf(11)?.pictures ?? null).toBeNull()
    expect(world.entryOf(12)?.library ?? null).toEqual(MOVIES)
    // A file with no title has no picture to wait for.
    expect(world.entryOf(12)?.pictures ?? null).toEqual({ art: null, logo: null, isComplete: true })
    world.table[mediaCall(11)] = ok(mediaItemFor({ id: 11, libraryId: 1 }))
    await world.keeper.fill()
    expect(world.entryOf(11)?.library ?? null).toEqual(MOVIES)
  })
})

describe('sweeping pictures', () => {
  const pictures: EntryPictures = { art: POSTER, logo: LOGO, isComplete: true }
  const disk = {
    [`${PICTURES}/item-4/${POSTER.id}.jpg`]: 3,
    [`${PICTURES}/item-4/${LOGO.id}.png`]: 2,
    [`${PICTURES}/album-7/${pictureIdOf(5)}.jpg`]: 3,
    [`/data/downloads/${SERVER_ID}/11/video.mkv`]: 8,
  }

  it("keeps a title's pictures while one of its downloads is left, and removes the rest", async () => {
    const world = setup({ entries: [episodeFor({ n: 11, overrides: { pictures } })], disk })
    await world.keeper.sweep()
    expect(world.drive.removed).toEqual([`${PICTURES}/album-7`])
    expect(world.drive.files.has(`${PICTURES}/item-4/${POSTER.id}.jpg`)).toBe(true)
    expect(world.drive.files.has(`/data/downloads/${SERVER_ID}/11/video.mkv`)).toBe(true)
  })

  it("removes a title's pictures once its last download is gone", async () => {
    const world = setup({ entries: [episodeFor({ n: 11, overrides: { pictures } })], disk })
    world.store.update((state) => ({ ...state, entries: [] }))
    await world.keeper.sweep()
    expect(world.drive.removed.toSorted()).toEqual([`${PICTURES}/album-7`, `${PICTURES}/item-4`])
  })

  it('touches only folders named as a picture folder is, and none where there are no downloads', async () => {
    const world = setup({ disk: { [`${PICTURES}/notes/readme.txt`]: 1 } })
    await world.keeper.sweep()
    expect(world.drive.removed).toEqual([])
    const empty = setup()
    await empty.keeper.sweep()
    expect(empty.drive.removed).toEqual([])
    expect(empty.warnings).toEqual([])
  })

  it('waits for a pass under way, so a picture just written is named before it sweeps', async () => {
    const world = setup({
      entries: [episodeFor({ n: 11 })],
      replies: { [showCall]: ok(SHOW) },
      served: { [POSTER_PATH]: JPEG, [LOGO_PATH]: PNG },
    })
    const filling = world.keeper.fill()
    await world.keeper.sweep()
    await filling
    expect(world.drive.removed).toEqual([])
    expect(world.drive.files.size).toBe(2)
  })
})
