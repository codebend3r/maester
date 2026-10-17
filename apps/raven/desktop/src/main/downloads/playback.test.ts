import { describe, expect, it } from 'bun:test'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  clearPending,
  EMPTY_DOWNLOADS,
  NO_PENDING,
  remove,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { createDownloadPlayback } from '@/main/downloads/playback'
import { createGrants } from '@/main/grants'
import {
  addRecent,
  EMPTY_STATE,
  type FileFacts,
  type PlayerState,
  savePosition,
} from '@/main/playerState'
import type { JsonStore } from '@/main/stateStore'
import { ticks, until } from '@/main/test/downloadFakes'
import { isOpaqueId, MAX_QUEUE, type DesktopReply } from '@/shared/protocol'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_DATA = '/data'
const DOWNLOADS = `${USER_DATA}/downloads`
const NOW = 1_700_000_000_000
/** When every file on the fake disk was last changed. */
const MTIME = 1_600_000_000_000
const GIB = 1024 ** 3
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff'
const MOVIE_PATH = '/Movies/x.mkv'

type Video = { size: number; mtimeMs: number }

const FILE: Video = { size: 2 * GIB, mtimeMs: MTIME }

const videoOf = (mediaId: number, serverId = SERVER_ID): string =>
  `${DOWNLOADS}/${serverId}/${mediaId}/video.mkv`

const VIDEO = videoOf(11)

const entryFor = (overrides: Partial<DownloadEntry>): DownloadEntry => ({
  downloadId: ID,
  serverId: SERVER_ID,
  mediaId: 11,
  label: 'S01E01 Good News',
  group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_001 },
  container: 'mkv',
  size: 2 * GIB,
  duration: 3000,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: 'ready' },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: NOW - 1000,
  ...overrides,
})

const episodeOf = (n: number, overrides: Partial<DownloadEntry> = {}): DownloadEntry =>
  entryFor({
    downloadId: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    mediaId: 10 + n,
    label: `Episode ${n}`,
    group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_000 + n },
    ...overrides,
  })

/** Each entry's finished video, as the fake disk keeps it. */
const shelved = (...entries: DownloadEntry[]): Record<string, Video> =>
  Object.fromEntries(
    entries.map((entry) => [
      videoOf(entry.mediaId, entry.serverId),
      { size: entry.size, mtimeMs: MTIME },
    ]),
  )

const factsOf = (path: string, video: Video = FILE): FileFacts => ({ path, ...video })

/** A player state holding a recent and a resume spot at 100 of 3000 for each path. */
const remembering = (...paths: string[]): PlayerState =>
  paths.reduce(
    (state, path) =>
      savePosition({
        state: addRecent({ state, path, at: 1 }),
        file: factsOf(path),
        position: 100,
        duration: 3000,
        at: 1,
      }),
    EMPTY_STATE,
  )

const pathsIn = (state: PlayerState) => ({
  recents: state.recents.flatMap((recent) => (recent.kind === 'file' ? [recent.path] : [])),
  resume: state.resume.map(({ path }) => path),
})

/** A store held in memory that never writes a file. */
const memoryStore = <T>(initial: T): JsonStore<T> => {
  const held = { value: initial }
  return {
    read: () => held.value,
    update: (apply) => {
      held.value = apply(held.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
}

const missing = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

const fileIds = (): (() => string) => {
  const counter = { n: 0 }
  return () => {
    counter.n += 1
    return `20000000-0000-4000-8000-${String(counter.n).padStart(12, '0')}`
  }
}

const setup = ({
  entries = [],
  videos = {},
  player = EMPTY_STATE,
}: {
  entries?: DownloadEntry[]
  /** Finished videos by path. */
  videos?: Record<string, Video>
  player?: PlayerState
} = {}) => {
  const store = memoryStore<DownloadsState>({ ...EMPTY_DOWNLOADS, entries })
  const state = memoryStore(player)
  const shelf = new Map(Object.entries(videos))
  const videoAt = (path: string): Video => {
    const video = shelf.get(path)
    if (video === undefined) throw missing()
    return video
  }
  /** What every grant and every read of a file waits on, so a test can hold one. */
  const granting: { hold: Promise<void> } = { hold: Promise.resolve() }
  const reading: { hold: Promise<void> } = { hold: Promise.resolve() }
  const grants = createGrants({
    fs: {
      realpath: async (path) => {
        await granting.hold
        videoAt(path)
        return path
      },
      stat: async (path) => ({ isFile: () => true, ...videoAt(path) }),
    },
    newId: fileIds(),
  })
  const clock = { now: NOW }
  const warnings: string[] = []
  const names = new Map([[SERVER_ID, 'Vhagar']])
  const statted: string[] = []
  const told = { lists: 0 }
  const noted: string[] = []
  const left = { count: 0 }
  const playback = createDownloadPlayback({
    store,
    userData: USER_DATA,
    grants,
    state,
    stat: async (path) => {
      statted.push(path)
      await reading.hold
      return videoAt(path)
    },
    now: () => clock.now,
    warn: (message) => warnings.push(message),
    serverNameOf: (serverId) => names.get(serverId) ?? '',
    change: (apply) => store.update(apply),
    announce: () => {
      told.lists += 1
    },
    onNoted: ({ downloadId }) => noted.push(downloadId),
    onLeft: () => {
      left.count += 1
    },
  })
  return {
    playback,
    store,
    state,
    grants,
    granting,
    reading,
    shelf,
    clock,
    warnings,
    names,
    statted,
    told,
    noted,
    left,
  }
}

type World = ReturnType<typeof setup>

const pathOf = (world: World, fileId: string): string | null =>
  world.grants.fileOf(fileId)?.path ?? null

const targetOf = (reply: DesktopReply) => {
  if (reply.type !== 'play') throw new Error(`expected play, got ${reply.type}`)
  return reply.target
}

const opened = async (world: World, downloadId = ID): Promise<string> =>
  targetOf(await world.playback.open({ downloadId })).fileId

/** A grant made outside `open`, as Home's recents, a drop or the open dialog make one. */
const granted = async (world: World, path: string): Promise<string> => {
  const result = await world.grants.grant(path)
  if (!result.ok) throw new Error(`expected a grant, got ${result.reason}`)
  return result.file.fileId
}

const entryOf = (world: World, downloadId = ID) =>
  world.store.read().entries.find((entry) => entry.downloadId === downloadId) ?? null

/** As the queue removes a download: it leaves the list, then `onRemoved` hears of it. */
const removing = (world: World, downloadId = ID): void => {
  const entry = entryOf(world, downloadId)
  if (entry === null) throw new Error('no such download')
  world.store.update((state) => remove(state, { downloadId }))
  world.playback.forget([entry])
}

/** A download of the same title again, under a new id, at the same path. */
const downloadedAgain = (world: World, overrides: Partial<DownloadEntry> = {}): void => {
  world.store.update((state) => ({
    ...state,
    entries: [...state.entries, entryFor({ downloadId: OTHER_ID, ...overrides })],
  }))
}

describe('open', () => {
  it("plays a ready download as a local file, with its group's later ready files queued in order", async () => {
    const movie = entryFor({
      downloadId: '00000000-0000-4000-9000-0000000000aa',
      mediaId: 41,
      label: 'Dune (2021)',
      group: { kind: 'movie', key: 'movie:41', title: 'Dune (2021)', order: 0 },
    })
    const ready = [episodeOf(3), episodeOf(1), episodeOf(2), episodeOf(5), movie]
    const world = setup({
      entries: [...ready, episodeOf(4, { status: { kind: 'queued' } })],
      videos: shelved(...ready),
    })
    const target = targetOf(await world.playback.open({ downloadId: episodeOf(2).downloadId }))
    expect(isOpaqueId(target.fileId)).toBe(true)
    expect(pathOf(world, target.fileId)).toBe(videoOf(12))
    expect(target.queue.map((fileId) => pathOf(world, fileId))).toEqual([videoOf(13), videoOf(15)])
  })

  it('queues at most MAX_QUEUE files after the one it plays', async () => {
    const entries = Array.from({ length: MAX_QUEUE + 2 }, (_, index) => episodeOf(index + 1))
    const world = setup({ entries, videos: shelved(...entries) })
    const target = targetOf(await world.playback.open({ downloadId: episodeOf(1).downloadId }))
    expect(target.queue).toHaveLength(MAX_QUEUE)
    expect(pathOf(world, target.queue.at(-1) ?? '')).toBe(videoOf(11 + MAX_QUEUE))
  })

  it('refuses a download that is not ready, and one it does not hold', async () => {
    const world = setup({
      entries: [entryFor({ status: { kind: 'paused', bytes: 7, reason: 'viewer' } })],
      videos: { [VIDEO]: FILE },
    })
    const unknown = { type: 'refused', message: DOWNLOAD_MESSAGES.unknown } as const
    expect(await world.playback.open({ downloadId: ID })).toEqual(unknown)
    expect(await world.playback.open({ downloadId: UNKNOWN_ID })).toEqual(unknown)
  })

  it('refuses a download whose file has gone, and warns by its title alone', async () => {
    const world = setup({ entries: [entryFor({})] })
    expect(await world.playback.open({ downloadId: ID })).toEqual({
      type: 'refused',
      message: DOWNLOAD_MESSAGES.fileGone,
    })
    expect(world.warnings).toEqual([expect.stringContaining('S01E01 Good News')])
    expect(world.warnings.join('\n')).not.toContain('video.mkv')
  })

  it('leaves out of the queue a file that has gone, and warns by its title alone', async () => {
    const world = setup({
      entries: [episodeOf(1), episodeOf(2), episodeOf(3)],
      videos: shelved(episodeOf(1), episodeOf(3)),
    })
    const target = targetOf(await world.playback.open({ downloadId: episodeOf(1).downloadId }))
    expect(target.queue.map((fileId) => pathOf(world, fileId))).toEqual([videoOf(13)])
    expect(world.warnings).toEqual([expect.stringContaining('Episode 2')])
    expect(world.warnings.join('\n')).not.toContain('video.mkv')
  })
})

describe('nextOf', () => {
  it("offers the group's next ready download after one granted outside the Downloads page", async () => {
    const ready = [episodeOf(1), episodeOf(3), episodeOf(4)]
    const world = setup({
      entries: [...ready, episodeOf(2, { status: { kind: 'queued' } })],
      videos: shelved(...ready),
    })
    const next = await world.playback.nextOf({ fileId: await granted(world, videoOf(11)) })
    expect(next?.path).toBe(videoOf(13))
    expect(world.playback.labelOf({ path: next?.path ?? '' })).toBe('Episode 3')
  })

  it('skips a later download whose file has gone', async () => {
    const world = setup({
      entries: [episodeOf(1), episodeOf(2), episodeOf(3)],
      videos: shelved(episodeOf(1), episodeOf(3)),
    })
    const next = await world.playback.nextOf({
      fileId: await opened(world, episodeOf(1).downloadId),
    })
    expect(next?.path).toBe(videoOf(13))
  })

  it('offers none after the last of its group, nor for a file that is no download', async () => {
    const movie = entryFor({
      downloadId: '00000000-0000-4000-9000-0000000000aa',
      mediaId: 41,
      label: 'Dune (2021)',
      group: { kind: 'movie', key: 'movie:41', title: 'Dune (2021)', order: 0 },
    })
    const entries = [episodeOf(1), episodeOf(2), movie]
    const world = setup({ entries, videos: { ...shelved(...entries), [MOVIE_PATH]: FILE } })
    expect(await world.playback.nextOf({ fileId: await granted(world, videoOf(12)) })).toBeNull()
    expect(await world.playback.nextOf({ fileId: await granted(world, MOVIE_PATH) })).toBeNull()
    expect(await world.playback.nextOf({ fileId: UNKNOWN_ID })).toBeNull()
  })
})

describe('what names a download', () => {
  it("lists a download's subtitles under its subtitles folder, and none for another file", async () => {
    const world = setup({
      entries: [
        entryFor({
          sidecars: [
            { trackId: 'external-0', title: 'English', language: 'en' },
            { trackId: 'external-2', title: 'Forced', language: 'en' },
          ],
        }),
      ],
      videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE },
    })
    const fileId = await opened(world)
    expect(world.playback.sidecarsOf(fileId)).toEqual([
      {
        path: `${DOWNLOADS}/${SERVER_ID}/11/subtitles/external-0.vtt`,
        title: 'English',
        language: 'en',
      },
      {
        path: `${DOWNLOADS}/${SERVER_ID}/11/subtitles/external-2.vtt`,
        title: 'Forced',
        language: 'en',
      },
    ])
    expect(world.playback.sidecarsOf(await granted(world, MOVIE_PATH))).toEqual([])
    expect(world.playback.sidecarsOf(UNKNOWN_ID)).toEqual([])
  })

  it("says a download came from its server by the server's name now, and nothing for another file", () => {
    const world = setup({ entries: [entryFor({})] })
    expect(world.playback.fromLabelOf({ path: VIDEO })).toBe('Downloaded from Vhagar')
    expect(world.playback.fromLabelOf({ path: MOVIE_PATH })).toBeNull()
    expect(world.playback.fromLabelOf({ path: `${DOWNLOADS}/../Movies/x.mkv` })).toBeNull()
    expect(world.playback.fromLabelOf({ path: `${DOWNLOADS}/x.mkv` })).toBeNull()
    world.names.set(SERVER_ID, 'Caraxes')
    expect(world.playback.fromLabelOf({ path: VIDEO })).toBe('Downloaded from Caraxes')
  })

  it('says only "Downloaded" for a download of a server raven player no longer keeps, never its folder', () => {
    const world = setup({ entries: [entryFor({ serverId: OTHER_SERVER_ID })] })
    expect(world.playback.fromLabelOf({ path: videoOf(11, OTHER_SERVER_ID) })).toBe('Downloaded')
  })

  it("names a download's video by its title, and nothing for another file", () => {
    const world = setup({ entries: [entryFor({})] })
    expect(world.playback.labelOf({ path: VIDEO })).toBe('S01E01 Good News')
    expect(world.playback.labelOf({ path: MOVIE_PATH })).toBeNull()
  })
})

describe('notePosition', () => {
  it('counts the first position after an open as a play, and notes every position', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.clock.now = NOW + 1
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({
      play: true,
      position: 100,
      furthest: 100,
      at: NOW + 1,
    })
    // What a sync sent is cleared, so a second play would show.
    world.store.update((state) =>
      clearPending(state, {
        downloadId: ID,
        sentPlay: true,
        sentPosition: 100,
        sentFurthest: 100,
      }),
    )
    world.clock.now = NOW + 2
    world.playback.notePosition({ fileId, position: 200, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({
      play: false,
      position: 200,
      furthest: 200,
      at: NOW + 2,
    })
    expect(await opened(world)).toBe(fileId)
    world.playback.notePosition({ fileId, position: 300, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({
      play: true,
      position: 300,
      furthest: 300,
      at: NOW + 2,
    })
  })

  it('tells the sync after each position noted for a download, and for no other file', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE } })
    const fileId = await opened(world)
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    world.playback.notePosition({ fileId, position: 200, duration: 3000 })
    expect(world.noted).toEqual([ID, ID])
    const otherId = await granted(world, MOVIE_PATH)
    world.playback.notePosition({ fileId: otherId, position: 100, duration: 3000 })
    expect(world.noted).toEqual([ID, ID])
  })

  it("marks a download watched once a position reaches its library's Watched at, and keeps the first time", async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.playback.notePosition({ fileId, position: 2699, duration: null })
    expect(entryOf(world)?.watchedAt).toBeNull()
    world.clock.now = NOW + 5
    world.playback.notePosition({ fileId, position: 2700, duration: null })
    expect(entryOf(world)?.watchedAt).toBe(NOW + 5)
    world.clock.now = NOW + 9
    world.playback.notePosition({ fileId, position: 2990, duration: 3000 })
    expect(entryOf(world)?.watchedAt).toBe(NOW + 5)
  })

  it("reads the player's length before the entry's", async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.playback.notePosition({ fileId, position: 900, duration: 1000 })
    expect(entryOf(world)?.watchedAt).toBe(NOW)
  })

  it('knows a download opened outside the Downloads page by its path, and counts a play once the page opens it', async () => {
    const world = setup({
      entries: [
        entryFor({ sidecars: [{ trackId: 'external-0', title: 'English', language: 'en' }] }),
      ],
      videos: { [VIDEO]: FILE },
    })
    const fileId = await granted(world, VIDEO)
    expect(world.playback.sidecarsOf(fileId)).toHaveLength(1)
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: false, position: 100, furthest: 100, at: NOW })
    world.playback.noteOpened({ fileId })
    world.playback.notePosition({ fileId, position: 150, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: true, position: 150, furthest: 150, at: NOW })
  })

  it('notes nothing for a file that is not a download', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE } })
    const before = world.store.read()
    const fileId = await granted(world, MOVIE_PATH)
    world.playback.noteOpened({ fileId })
    world.playback.notePosition({ fileId, position: 2900, duration: 3000 })
    world.playback.notePosition({ fileId: UNKNOWN_ID, position: 2900, duration: 3000 })
    expect(world.store.read()).toBe(before)
  })

  it('forgets a removed download, and reaches the same title downloaded again at its path', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    removing(world)
    const before = world.store.read()
    world.playback.notePosition({ fileId, position: 50, duration: 3000 })
    expect(world.store.read()).toBe(before)
    expect(world.playback.sidecarsOf(fileId)).toEqual([])
    downloadedAgain(world, {
      sidecars: [{ trackId: 'external-0', title: 'English', language: 'en' }],
    })
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world, OTHER_ID)?.pending).toEqual({
      play: false,
      position: 100,
      furthest: 100,
      at: NOW,
    })
    expect(world.playback.sidecarsOf(fileId)).toHaveLength(1)
  })

  it('reaches the same title downloaded again after its download was removed while it was granted', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const held = Promise.withResolvers<void>()
    world.granting.hold = held.promise
    const opening = world.playback.open({ downloadId: ID })
    removing(world)
    held.resolve()
    const { fileId } = targetOf(await opening)
    world.playback.notePosition({ fileId, position: 50, duration: 3000 })
    downloadedAgain(world)
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    // The open that raced the removal counts no play for the new download.
    expect(entryOf(world, OTHER_ID)?.pending).toEqual({
      play: false,
      position: 100,
      furthest: 100,
      at: NOW,
    })
  })
})

describe('what is playing', () => {
  const SECOND = episodeOf(2)

  it('holds a download playing from the moment the page opens its file until the page leaves it', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    expect(world.playback.isPlaying(ID)).toBe(false)
    world.playback.noteOpened({ fileId })
    expect(world.playback.isPlaying(ID)).toBe(true)
    world.playback.playbackLeft({ fileId })
    expect(world.playback.isPlaying(ID)).toBe(false)
  })

  it('keeps the next file playing when the page leaves the one before it late', async () => {
    const world = setup({ entries: [entryFor({}), SECOND], videos: shelved(entryFor({}), SECOND) })
    const first = await opened(world)
    const second = await opened(world, SECOND.downloadId)
    world.playback.noteOpened({ fileId: first })
    world.playback.noteOpened({ fileId: second })
    expect(world.playback.isPlaying(ID)).toBe(false)
    world.playback.playbackLeft({ fileId: first })
    expect(world.playback.isPlaying(SECOND.downloadId)).toBe(true)
  })

  it('leaves a download for a file that is no download, a server title and the player hiding', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE } })
    const fileId = await opened(world)
    const movie = await granted(world, MOVIE_PATH)
    world.playback.noteOpened({ fileId })
    world.playback.noteOpened({ fileId: movie })
    expect(world.playback.isPlaying(ID)).toBe(false)
    world.playback.notePlaying({ fileId })
    expect(world.playback.isPlaying(ID)).toBe(true)
    world.playback.notePlaying({ fileId: null })
    expect(world.playback.isPlaying(ID)).toBe(false)
  })

  it('says each time the player leaves a download, and at no other move', async () => {
    const world = setup({
      entries: [entryFor({}), SECOND],
      videos: { ...shelved(entryFor({}), SECOND), [MOVIE_PATH]: FILE },
    })
    const first = await opened(world)
    const second = await opened(world, SECOND.downloadId)
    const movie = await granted(world, MOVIE_PATH)
    world.playback.noteOpened({ fileId: first })
    world.playback.notePlaying({ fileId: first })
    world.playback.playbackLeft({ fileId: second })
    expect(world.left.count).toBe(0)
    world.playback.noteOpened({ fileId: second })
    expect(world.left.count).toBe(1)
    world.playback.notePlaying({ fileId: null })
    world.playback.notePlaying({ fileId: null })
    world.playback.noteOpened({ fileId: movie })
    expect(world.left.count).toBe(2)
    world.playback.noteOpened({ fileId: first })
    world.playback.playbackLeft({ fileId: first })
    expect(world.left.count).toBe(3)
  })
})

describe('a title left partway', () => {
  /** A player state holding a resume spot for the video at `position` of 3000. */
  const spotAt = (position: number, path = VIDEO): PlayerState =>
    savePosition({ state: EMPTY_STATE, file: factsOf(path), position, duration: 3000, at: 1 })

  it('reads a download as left partway while it resumes short of where it counts as watched', () => {
    const world = setup({ entries: [entryFor({})], player: spotAt(1500) })
    expect(world.playback.isMidTitle(ID)).toBe(true)
  })

  it.each([
    ['resumes past where it counts as watched', spotAt(2800)],
    ['was played to its end', spotAt(2995)],
    ['has no resume spot', EMPTY_STATE],
    ["holds only another file's spot", spotAt(1500, MOVIE_PATH)],
  ])('reads a download as no longer partway once it %s', (_, player) => {
    const world = setup({ entries: [entryFor({})], player })
    expect(world.playback.isMidTitle(ID)).toBe(false)
  })

  it('reads a download it does not hold as not partway', () => {
    const world = setup({ entries: [entryFor({})], player: spotAt(1500) })
    expect(world.playback.isMidTitle(UNKNOWN_ID)).toBe(false)
  })

  it('reads the spot of a replaced file as none, once its facts are read', async () => {
    const world = setup({
      entries: [entryFor({})],
      videos: { [VIDEO]: { size: 2 * GIB, mtimeMs: MTIME + 1 } },
      player: spotAt(1500),
    })
    world.playback.readFiles([entryFor({})])
    await until(() => world.statted.length === 1)
    await ticks(3)
    expect(world.playback.isMidTitle(ID)).toBe(false)
  })
})

describe('where a download starts', () => {
  it("answers the server's resume spot for a download, and 0 for any other file", async () => {
    const world = setup({
      entries: [entryFor({ serverPosition: 4200 })],
      videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE },
    })
    expect(world.playback.serverPositionOf({ fileId: await opened(world) })).toBe(4200)
    expect(world.playback.serverPositionOf({ fileId: await granted(world, MOVIE_PATH) })).toBe(0)
    expect(world.playback.serverPositionOf({ fileId: UNKNOWN_ID })).toBe(0)
  })

  it('forgets it once a position is noted, so only the local spot decides from then on', async () => {
    const world = setup({
      entries: [entryFor({ serverPosition: 4200 })],
      videos: { [VIDEO]: FILE },
    })
    const fileId = await opened(world)
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    expect(world.playback.serverPositionOf({ fileId })).toBe(0)
    expect(entryOf(world)?.serverPosition).toBe(0)
  })

  it('answers 0 for a download the server had no spot for', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    expect(world.playback.serverPositionOf({ fileId: await opened(world) })).toBe(0)
  })
})

describe('the share watched', () => {
  it("reads each file's facts and shows its share, telling the page once", async () => {
    const replaced = videoOf(12)
    const player = [
      { file: factsOf(VIDEO), position: 1500 },
      { file: factsOf(replaced, { size: 2 * GIB, mtimeMs: MTIME - 1 }), position: 1500 },
    ].reduce(
      (state, { file, position }) => savePosition({ state, file, position, duration: 3000, at: 1 }),
      EMPTY_STATE,
    )
    const entries = [entryFor({}), entryFor({ downloadId: OTHER_ID, mediaId: 12 })]
    const world = setup({ entries, videos: shelved(...entries), player })
    expect(world.playback.watchedOf(entryFor({}))).toBeNull()
    world.playback.readFiles(entries)
    await until(() => world.told.lists === 1)
    expect(world.playback.watchedOf(entryFor({}))).toBe(0.5)
    expect(world.playback.watchedOf(entryFor({ downloadId: OTHER_ID, mediaId: 12 }))).toBeNull()
    expect(world.statted.toSorted()).toEqual([VIDEO, replaced])
  })

  it('reads 1 for a download marked watched, whatever its resume spot says', async () => {
    const world = setup({
      entries: [entryFor({ watchedAt: NOW }), entryFor({ downloadId: OTHER_ID, mediaId: 12 })],
      player: remembering(VIDEO, videoOf(12)),
    })
    expect(world.playback.watchedOf(entryFor({ watchedAt: NOW }))).toBe(1)
    expect(world.playback.watchedOf(entryFor({ downloadId: OTHER_ID, mediaId: 12 }))).toBeNull()
    expect(world.playback.isWatched({ path: VIDEO })).toBe(true)
    expect(world.playback.isWatched({ path: videoOf(12) })).toBe(false)
    expect(world.playback.isWatched({ path: MOVIE_PATH })).toBe(false)
  })

  it('tells the page nothing when no file could be read', async () => {
    const world = setup({ entries: [entryFor({})] })
    world.playback.readFiles([entryFor({})])
    await until(() => world.statted.length === 1)
    await ticks(5)
    expect(world.told.lists).toBe(0)
    expect(world.playback.watchedOf(entryFor({}))).toBeNull()
  })

  it('keeps nothing for a download removed while its file was read', async () => {
    const world = setup({
      entries: [entryFor({})],
      videos: { [VIDEO]: FILE },
      player: remembering(VIDEO),
    })
    const held = Promise.withResolvers<void>()
    world.reading.hold = held.promise
    world.playback.readFiles([entryFor({})])
    removing(world)
    held.resolve()
    await ticks(5)
    world.state.update((state) =>
      savePosition({ state, file: factsOf(VIDEO), position: 1500, duration: 3000, at: 1 }),
    )
    expect(world.playback.watchedOf(entryFor({}))).toBeNull()
    expect(world.told.lists).toBe(0)
  })

  it('reads the share off the facts a noted position was saved under', async () => {
    const world = setup({ entries: [entryFor({})], videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.state.update((state) =>
      savePosition({ state, file: factsOf(VIDEO), position: 750, duration: 3000, at: NOW }),
    )
    world.playback.notePosition({ fileId, position: 750, duration: 3000 })
    expect(world.playback.watchedOf(entryFor({}))).toBe(0.25)
  })
})

describe('forget', () => {
  it("drops a removed download's recent, resume spot and share, and keeps another file's", async () => {
    const world = setup({
      entries: [entryFor({})],
      videos: { [VIDEO]: FILE },
      player: remembering(VIDEO, MOVIE_PATH),
    })
    const fileId = await opened(world)
    world.playback.notePosition({ fileId, position: 100, duration: 3000 })
    expect(world.playback.watchedOf(entryFor({}))).not.toBeNull()
    removing(world)
    expect(pathsIn(world.state.read())).toEqual({ recents: [MOVIE_PATH], resume: [MOVIE_PATH] })
    expect(world.playback.watchedOf(entryFor({}))).toBeNull()
  })

  it('leaves the player state as it was when nothing names the removed download', () => {
    const player = remembering(MOVIE_PATH)
    const world = setup({ entries: [entryFor({})], player })
    removing(world)
    expect(world.state.read()).toBe(player)
  })
})
