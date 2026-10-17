import { describe, expect, it } from 'bun:test'
import { LOCKED_STATUS, type DownloadTarget, type MediaItem, type Saga } from '@raven/core'
import { EMPTY_CONFIG, type ConfigStore, type DesktopConfig } from '@/main/desktopConfig'
import { ASK_TTL_MS } from '@/main/downloads/asks'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  createDownloadService,
  DOWNLOADS_EVENT_MS,
  viewStatusOf,
} from '@/main/downloads/downloadService'
import {
  clearPending,
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
  type EntryStatus,
} from '@/main/downloads/downloadState'
import { RESUME_SETTLE_MS } from '@/main/downloads/downloadQueue'
import { DOWNLOADS_DEBOUNCE_MS } from '@/main/downloads/downloadStore'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import type { AccessOutcome } from '@/main/downloads/mediaAccess'
import { SPACE_RESERVE_BYTES } from '@/main/downloads/space'
import { createGrants } from '@/main/grants'
import {
  addRecent,
  EMPTY_STATE,
  type FileFacts,
  type PlayerState,
  savePosition,
} from '@/main/playerState'
import { createJsonStore, type StateFs } from '@/main/stateStore'
import {
  fakeAccess,
  fakeDisk,
  fakeNetwork,
  serving,
  ticketFor,
  ticks,
  until,
} from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'
import {
  details,
  episode,
  fakeCalls,
  keyOf,
  library,
  ok,
  show,
  type Reply,
} from '@/main/test/serverFakes'
import {
  isOpaqueId,
  MAX_QUEUE,
  SERVER_GONE,
  type DesktopEvent,
  type DesktopReply,
} from '@/shared/protocol'
import { mediaItemFor } from '@/shared/test/mediaItem'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_DATA = '/data'
const NOW = 1_700_000_000_000
const GIB = 1024 ** 3
const BLOCK = 4096

const SERVER = { id: SERVER_ID, origin: 'https://vhagar.example', name: 'Vhagar', addedAt: 1 }

const DOWNLOADS = `${USER_DATA}/downloads`

const FAR_TICKET = ticketFor({ ticket: 'one', renewAt: NOW + 6 * 3_600_000 })

/** An access read that never answers, so a queued file waits where it is. */
const NEVER = (): Promise<AccessOutcome> => new Promise(() => undefined)

const missing = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

const memoryFs = (): StateFs => {
  const files = new Map<string, string>()
  return {
    readFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) throw missing()
      return text
    },
    writeFile: async ({ path, data }) => {
      files.set(path, data)
    },
    rename: async ({ from, to }) => {
      const text = files.get(from)
      if (text === undefined) throw missing()
      files.delete(from)
      files.set(to, text)
    },
  }
}

const memoryConfig = (): ConfigStore => {
  const state: { value: DesktopConfig } = { value: { ...EMPTY_CONFIG, servers: [SERVER] } }
  return {
    read: () => state.value,
    update: (change) => {
      state.value = change(state.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
}

const sequentialIds = (prefix = '00000000'): (() => string) => {
  const counter = { n: 0 }
  return () => {
    counter.n += 1
    return `${prefix}-0000-4000-8000-${String(counter.n).padStart(12, '0')}`
  }
}

/** When every file on the fake disk was last changed. */
const MTIME = 1_600_000_000_000

type Video = { size: number; mtimeMs: number }

const libraryCall = keyOf({ name: 'getLibrary', libraryId: 1 })
const mediaCall = (mediaId: number): string => keyOf({ name: 'getMedia', mediaId })
const itemCall = (itemId: number): string => keyOf({ name: 'getItem', itemId })
const sagasCall = keyOf({ name: 'getSagas', libraryId: 1 })

const MOVIE = mediaItemFor({ id: 9, title: 'Fellowship', year: 2001, size: 41 * GIB })

const episodeFile = (id: number): MediaItem =>
  mediaItemFor({ id, title: `Episode ${id}`, size: 2 * GIB, duration: 3000 })

const SEASON = details({
  id: 5,
  type: 'season',
  title: 'Season 1',
  show,
  season: 1,
  children: [
    episode({ id: 51, season: 1, number: 1, title: 'Good News', primary: episodeFile(11) }),
    episode({ id: 52, season: 1, number: 2, title: 'Half Loop', primary: episodeFile(12) }),
    episode({ id: 53, season: 1, number: 3, title: 'In Perpetuity', primary: episodeFile(13) }),
  ],
})

const entryFor = (overrides: Partial<DownloadEntry>): DownloadEntry => ({
  downloadId: '0f8fad5b-d9cb-469f-a165-70867728950e',
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
  pending: NO_PENDING,
  createdAt: NOW - 1000,
  ...overrides,
})

const setup = ({
  replies = {},
  free = 412 * GIB,
  total = 1000 * GIB,
  initial = EMPTY_DOWNLOADS,
  access = NEVER,
  disk = {},
  videos = {},
  player = EMPTY_STATE,
}: {
  replies?: Record<string, Reply>
  free?: number
  total?: number
  initial?: DownloadsState
  access?: () => Promise<AccessOutcome>
  disk?: Record<string, number>
  /** Finished videos by path, kept apart from `disk`, whose seed holds every byte in memory. */
  videos?: Record<string, Video>
  player?: PlayerState
} = {}) => {
  const table: Record<string, Reply> = {
    [libraryCall]: ok(library({ id: 1, watchedPercent: 90 })),
    ...replies,
  }
  const { calls, log } = fakeCalls(table)
  const { timers, fire, pending } = fakeTimers()
  const config = memoryConfig()
  const store = createJsonStore({
    fs: memoryFs(),
    file: `${USER_DATA}/downloads.json`,
    initial,
    timers,
    debounceMs: DOWNLOADS_DEBOUNCE_MS,
    onError: (error) => {
      throw error
    },
  })
  const clock = { now: NOW }
  const sent: DesktopEvent[] = []
  const warnings: string[] = []
  const made: string[] = []
  const shown: string[] = []
  const drive = fakeDisk(disk)
  const network = fakeNetwork()
  const media = fakeAccess(access)
  const shelf = new Map(Object.entries(videos))
  const videoAt = (path: string): Video => {
    const video = shelf.get(path)
    if (video !== undefined) return video
    if (drive.files.has(path)) return { size: drive.sizeOf(path), mtimeMs: MTIME }
    throw missing()
  }
  /** What every grant waits on before it reads the file, so a test can hold one. */
  const granting: { hold: Promise<void> } = { hold: Promise.resolve() }
  const grants = createGrants({
    fs: {
      realpath: async (path) => {
        await granting.hold
        videoAt(path)
        return path
      },
      stat: async (path) => ({ isFile: () => true, ...videoAt(path) }),
    },
    newId: sequentialIds('20000000'),
  })
  const state = createJsonStore({
    fs: memoryFs(),
    file: `${USER_DATA}/player-state.json`,
    initial: player,
    timers: { set: () => 0, clear: () => undefined },
    debounceMs: 1000,
    onError: (error) => {
      throw error
    },
  })
  const statted: string[] = []
  const service = createDownloadService({
    store,
    config,
    calls,
    userData: USER_DATA,
    space: {
      mkdir: async (path) => {
        made.push(path)
      },
      statfs: async () => ({ bavail: free / BLOCK, bsize: BLOCK, blocks: total / BLOCK }),
    },
    timers,
    now: () => clock.now,
    newId: sequentialIds(),
    send: (event) => sent.push(event),
    warn: (message) => warnings.push(message),
    access: media.access,
    fetchFor: network.fetchFor,
    fs: drive.fs,
    showItemInFolder: (path) => shown.push(path),
    ready: Promise.resolve(),
    wasSetAside: false,
    grants,
    state,
    stat: async (path) => {
      statted.push(path)
      return videoAt(path)
    },
  })
  return {
    service,
    store,
    grants,
    granting,
    state,
    shelf,
    statted,
    config,
    table,
    log,
    fire,
    pending,
    clock,
    sent,
    warnings,
    made,
    shown,
    drive,
    network,
    media,
  }
}

type World = ReturnType<typeof setup>

const askFor = async ({ world, target }: { world: World; target: DownloadTarget }) => {
  const reply = await world.service.ask({ serverId: SERVER_ID, target })
  if (reply.type !== 'downloadAsk') throw new Error(`expected an ask, got ${reply.type}`)
  return reply.ask
}

const downloadsOf = (reply: DesktopReply) => {
  if (reply.type !== 'downloads') throw new Error(`expected downloads, got ${reply.type}`)
  return reply
}

const downloadEvents = (sent: readonly DesktopEvent[]) =>
  sent.filter((event) => event.type === 'downloads')

const askGone = { type: 'refused', message: DOWNLOAD_MESSAGES.askGone } as const

describe('constants', () => {
  it('keeps an ask ten minutes and sends at most four lists a second', () => {
    expect(ASK_TTL_MS).toBe(600_000)
    expect(DOWNLOADS_EVENT_MS).toBe(250)
  })

  it('words the notices and refusals as the spec fixes them', () => {
    expect(DOWNLOAD_MESSAGES.askGone).toBe(
      'That download request has expired. Open the title in raven on the web and choose Download to raven player again.',
    )
    expect(DOWNLOAD_MESSAGES.unknown).toBe('That download is no longer in raven player.')
    expect(
      DOWNLOAD_MESSAGES.queued({ files: 3, kind: 'saga', label: 'x', serverName: 'Vhagar' }),
    ).toBe('Downloading 3 movies from Vhagar')
    expect(
      DOWNLOAD_MESSAGES.queued({ files: 2, kind: 'movie', label: 'x', serverName: 'Vhagar' }),
    ).toBe('Downloading 2 movies from Vhagar')
    expect(
      DOWNLOAD_MESSAGES.queued({ files: 10, kind: 'show', label: 'x', serverName: 'Vhagar' }),
    ).toBe('Downloading 10 episodes from Vhagar')
    expect(
      DOWNLOAD_MESSAGES.queued({
        files: 1,
        kind: 'season',
        label: 'S01E02 Half Loop',
        serverName: 'Vhagar',
      }),
    ).toBe('Downloading S01E02 Half Loop from Vhagar')
    expect(DOWNLOAD_MESSAGES.noSpace).toBe('Not enough space')
    expect(DOWNLOAD_MESSAGES.changed).toBe('The file changed on the server')
    expect(DOWNLOAD_MESSAGES.answered({ serverName: 'Vhagar', status: 401 })).toBe(
      'Vhagar answered 401',
    )
    expect(DOWNLOAD_MESSAGES.relocked('Vhagar')).toBe('Vhagar locked this library again')
    expect(DOWNLOAD_MESSAGES.unreachable('Vhagar')).toBe('Vhagar could not be reached')
    expect(DOWNLOAD_MESSAGES.downloaded('Dune')).toBe('Downloaded Dune')
    expect(DOWNLOAD_MESSAGES.failed({ label: 'Dune', why: 'Not enough space' })).toBe(
      'Could not download Dune: Not enough space',
    )
    expect(DOWNLOAD_MESSAGES.deletedAfterWatching('Dune')).toBe('Deleted Dune after watching')
  })
})

describe('ask', () => {
  it('answers a movie as ready with its file count, bytes, the free space and whether it fits', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    expect(
      await world.service.ask({ serverId: SERVER_ID, target: { kind: 'media', mediaId: 9 } }),
    ).toEqual({
      type: 'downloadAsk',
      ask: {
        askId: '00000000-0000-4000-8000-000000000001',
        serverId: SERVER_ID,
        serverName: 'Vhagar',
        autoDelete: false,
        status: {
          kind: 'ready',
          title: 'Fellowship (2001)',
          downloadKind: 'movie',
          files: 1,
          bytes: 41 * GIB,
          free: 412 * GIB,
          fits: true,
        },
      },
    })
    expect(world.made).toEqual([`${USER_DATA}/downloads`])
  })

  it('answers that the files do not fit once the reserve is counted', async () => {
    const world = setup({
      replies: { [mediaCall(9)]: ok(MOVIE) },
      free: 41 * GIB + SPACE_RESERVE_BYTES - BLOCK,
    })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    expect(ask.status).toMatchObject({ kind: 'ready', fits: false })
  })

  it('fits less while other files are queued or downloading, and shows only its own bytes', async () => {
    const room = 41 * GIB + SPACE_RESERVE_BYTES + 5 * GIB
    const alone = setup({ replies: { [mediaCall(9)]: ok(MOVIE) }, free: room })
    expect(
      (await askFor({ world: alone, target: { kind: 'media', mediaId: 9 } })).status,
    ).toMatchObject({ kind: 'ready', bytes: 41 * GIB, fits: true })
    const busy = setup({
      replies: { [mediaCall(9)]: ok(MOVIE) },
      free: room,
      initial: {
        ...EMPTY_DOWNLOADS,
        entries: [
          entryFor({ mediaId: 11, size: 4 * GIB, status: { kind: 'queued' } }),
          entryFor({
            downloadId: '00000000-0000-4000-8000-0000000000a1',
            mediaId: 12,
            size: 4 * GIB,
            status: { kind: 'downloading', bytes: 2 * GIB },
          }),
          entryFor({
            downloadId: '00000000-0000-4000-8000-0000000000a2',
            mediaId: 13,
            size: 40 * GIB,
            status: { kind: 'paused', bytes: 0, reason: 'viewer' },
          }),
        ],
      },
    })
    expect(
      (await askFor({ world: busy, target: { kind: 'media', mediaId: 9 } })).status,
    ).toMatchObject({ kind: 'ready', bytes: 41 * GIB, fits: false })
  })

  it('counts and sizes only the files not yet downloaded', async () => {
    const world = setup({
      replies: { [itemCall(5)]: ok(SEASON) },
      initial: { ...EMPTY_DOWNLOADS, entries: [entryFor({ mediaId: 11 })] },
    })
    const ask = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    expect(ask.status).toMatchObject({
      kind: 'ready',
      downloadKind: 'season',
      files: 2,
      bytes: 4 * GIB,
    })
  })

  it('does not skip the same media id on another server', async () => {
    const world = setup({
      replies: { [itemCall(5)]: ok(SEASON) },
      initial: {
        ...EMPTY_DOWNLOADS,
        entries: [entryFor({ mediaId: 11, serverId: OTHER_SERVER_ID })],
      },
    })
    const ask = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    expect(ask.status).toMatchObject({ kind: 'ready', files: 3 })
  })

  it('answers locked for a library behind its PIN, and hidden behind the admin lock', async () => {
    const locked = setup({ replies: { [itemCall(5)]: { status: LOCKED_STATUS, body: '' } } })
    expect((await askFor({ world: locked, target: { kind: 'item', itemId: 5 } })).status).toEqual({
      kind: 'locked',
    })
    const hidden = setup({
      replies: { [keyOf({ name: 'getAdminLock' })]: ok({ state: 'on', available: true }) },
    })
    expect((await askFor({ world: hidden, target: { kind: 'item', itemId: 5 } })).status).toEqual({
      kind: 'hidden',
    })
  })

  it.each([
    ['gone', {}, EXPAND_MESSAGES.gone('Vhagar')],
    [
      'unreachable',
      { [itemCall(5)]: { unreachable: 'raven player could not reach Vhagar.' } },
      'raven player could not reach Vhagar.',
    ],
    ['unreadable', { [itemCall(5)]: ok({ id: 5 }) }, EXPAND_MESSAGES.unreadable('Vhagar')],
  ])('refuses an expansion that is %s with its message', async (_name, replies, message) => {
    const world = setup({ replies })
    expect(
      await world.service.ask({ serverId: SERVER_ID, target: { kind: 'item', itemId: 5 } }),
    ).toEqual({ type: 'refused', message })
  })

  it('refuses more files than one ask takes', async () => {
    const media = Array.from({ length: 501 }, (_, index) => episodeFile(index + 1))
    const sagas: Saga[] = [
      { tmdbId: '119', name: 'Saga', backdrop: { type: 'slideshow', motion: 'fade' }, media },
    ]
    const world = setup({ replies: { [sagasCall]: ok(sagas) } })
    expect(
      await world.service.ask({
        serverId: SERVER_ID,
        target: { kind: 'saga', libraryId: 1, tmdbId: '119' },
      }),
    ).toEqual({ type: 'refused', message: EXPAND_MESSAGES.tooMany })
  })

  it('refuses a file whose container could not be a file name, and warns by its title', async () => {
    const world = setup({
      replies: { [mediaCall(9)]: ok({ ...MOVIE, container: '../../x' }) },
    })
    expect(
      await world.service.ask({ serverId: SERVER_ID, target: { kind: 'media', mediaId: 9 } }),
    ).toEqual({ type: 'refused', message: EXPAND_MESSAGES.unreadable('Vhagar') })
    expect(world.warnings.join('\n')).toContain('Fellowship (2001)')
    expect(world.warnings.join('\n')).not.toContain('../../x')
  })

  it.each([
    ['below 0', -1],
    ['0', 0],
    ['not whole', 2.5],
  ])('refuses a file whose size is %s, and warns by its title', async (_name, size) => {
    const world = setup({ replies: { [mediaCall(9)]: ok({ ...MOVIE, size }) } })
    expect(
      await world.service.ask({ serverId: SERVER_ID, target: { kind: 'media', mediaId: 9 } }),
    ).toEqual({ type: 'refused', message: EXPAND_MESSAGES.unreadable('Vhagar') })
    expect(world.warnings.join('\n')).toContain('Fellowship (2001)')
  })

  it('refuses a server raven player no longer keeps, and calls nothing', async () => {
    const world = setup()
    expect(
      await world.service.ask({
        serverId: OTHER_SERVER_ID,
        target: { kind: 'media', mediaId: 9 },
      }),
    ).toEqual({ type: 'refused', message: SERVER_GONE })
    expect(world.log).toEqual([])
  })
})

describe('retryAsk', () => {
  it('expands again once the server unlocks, under the same ask id', async () => {
    const world = setup({ replies: { [itemCall(5)]: { status: LOCKED_STATUS, body: '' } } })
    const locked = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    expect(locked.status).toEqual({ kind: 'locked' })
    world.table[itemCall(5)] = ok(SEASON)
    const reply = await world.service.retryAsk({ askId: locked.askId })
    expect(reply).toMatchObject({
      type: 'downloadAsk',
      ask: { askId: locked.askId, status: { kind: 'ready', files: 3, bytes: 6 * GIB } },
    })
  })

  it('refuses an unknown or expired ask', async () => {
    const world = setup({ replies: { [itemCall(5)]: { status: LOCKED_STATUS, body: '' } } })
    expect(await world.service.retryAsk({ askId: '00000000-0000-4000-8000-000000000099' })).toEqual(
      askGone,
    )
    const locked = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    world.clock.now += ASK_TTL_MS + 1
    expect(await world.service.retryAsk({ askId: locked.askId })).toEqual(askGone)
  })

  it('drops an ask whose title has gone and refuses with why', async () => {
    const world = setup({ replies: { [itemCall(5)]: { status: LOCKED_STATUS, body: '' } } })
    const locked = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    world.table[itemCall(5)] = { status: 404, body: '' }
    expect(await world.service.retryAsk({ askId: locked.askId })).toEqual({
      type: 'refused',
      message: EXPAND_MESSAGES.gone('Vhagar'),
    })
    expect(await world.service.retryAsk({ askId: locked.askId })).toEqual(askGone)
  })
})

describe('confirm', () => {
  it('queues the files, skipping one already present, says so and answers the list', async () => {
    const present = entryFor({ mediaId: 11 })
    const world = setup({
      replies: { [itemCall(5)]: ok(SEASON) },
      initial: { ...EMPTY_DOWNLOADS, entries: [present] },
    })
    const ask = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    world.clock.now += 5000
    const reply = downloadsOf(await world.service.confirm({ askId: ask.askId, autoDelete: true }))
    const queued = world.store.read().entries.filter((entry) => entry !== present)
    expect(queued).toEqual([
      {
        downloadId: '00000000-0000-4000-8000-000000000002',
        serverId: SERVER_ID,
        mediaId: 12,
        label: 'S01E02 Half Loop',
        group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_002 },
        container: 'mkv',
        size: 2 * GIB,
        duration: 3000,
        watchedPercent: 90,
        sidecars: [],
        status: { kind: 'queued' },
        autoDelete: true,
        watchedAt: null,
        pending: NO_PENDING,
        createdAt: NOW + 5000,
      },
      expect.objectContaining({ mediaId: 13, label: 'S01E03 In Perpetuity', autoDelete: true }),
    ])
    expect(world.sent).toEqual([{ type: 'notice', message: 'Downloading 2 episodes from Vhagar' }])
    world.fire()
    expect(downloadEvents(world.sent)).toEqual([
      { type: 'downloads', downloads: reply.downloads, autoDeleteDefault: true },
    ])
    expect(reply.autoDeleteDefault).toBe(true)
    expect(reply.downloads.map(({ label }) => label)).toEqual([
      'S01E01 Good News',
      'S01E02 Half Loop',
      'S01E03 In Perpetuity',
    ])
  })

  it("keeps the dialog's choice as the default the next ask starts from", async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE), [itemCall(5)]: ok(SEASON) } })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    expect(ask.autoDelete).toBe(false)
    await world.service.confirm({ askId: ask.askId, autoDelete: true })
    expect(world.service.list()).toMatchObject({ type: 'downloads', autoDeleteDefault: true })
    expect((await askFor({ world, target: { kind: 'item', itemId: 5 } })).autoDelete).toBe(true)
    world.fire()
    expect(downloadEvents(world.sent)).toEqual([
      expect.objectContaining({ type: 'downloads', autoDeleteDefault: true }),
    ])
  })

  it('keeps the choice even when every file was queued meanwhile', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const first = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    const second = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    await world.service.confirm({ askId: first.askId, autoDelete: false })
    await world.service.confirm({ askId: second.askId, autoDelete: true })
    expect(world.store.read()).toMatchObject({ autoDeleteDefault: true })
    expect(world.store.read().entries).toHaveLength(1)
  })

  it('names the one file it queues', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    await world.service.confirm({ askId: ask.askId, autoDelete: false })
    expect(world.sent).toEqual([
      { type: 'notice', message: 'Downloading Fellowship (2001) from Vhagar' },
    ])
  })

  it('refuses an unknown ask, an expired one and one already answered', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    expect(
      await world.service.confirm({
        askId: '00000000-0000-4000-8000-000000000099',
        autoDelete: false,
      }),
    ).toEqual(askGone)
    const expired = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    world.clock.now += ASK_TTL_MS + 1
    expect(await world.service.confirm({ askId: expired.askId, autoDelete: false })).toEqual(
      askGone,
    )
    const answered = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    await world.service.confirm({ askId: answered.askId, autoDelete: false })
    expect(await world.service.confirm({ askId: answered.askId, autoDelete: false })).toEqual(
      askGone,
    )
    expect(world.store.read().entries).toHaveLength(1)
  })

  it('keeps an ask for its full ten minutes', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    world.clock.now += ASK_TTL_MS
    expect((await world.service.confirm({ askId: ask.askId, autoDelete: false })).type).toBe(
      'downloads',
    )
  })

  it('refuses a locked ask with why, and keeps it for the retry', async () => {
    const world = setup({ replies: { [itemCall(5)]: { status: LOCKED_STATUS, body: '' } } })
    const locked = await askFor({ world, target: { kind: 'item', itemId: 5 } })
    expect(await world.service.confirm({ askId: locked.askId, autoDelete: false })).toEqual({
      type: 'refused',
      message: 'Vhagar keeps that behind its PIN.',
    })
    world.table[itemCall(5)] = ok(SEASON)
    expect((await world.service.retryAsk({ askId: locked.askId })).type).toBe('downloadAsk')
  })

  it('refuses once the server has been removed, and queues nothing', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    world.config.update((current) => ({ ...current, servers: [] }))
    expect(await world.service.confirm({ askId: ask.askId, autoDelete: false })).toEqual({
      type: 'refused',
      message: SERVER_GONE,
    })
    expect(world.store.read().entries).toEqual([])
  })

  it('says nothing when every file was queued meanwhile', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const first = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    const second = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    await world.service.confirm({ askId: first.askId, autoDelete: false })
    world.sent.length = 0
    expect((await world.service.confirm({ askId: second.askId, autoDelete: false })).type).toBe(
      'downloads',
    )
    expect(world.sent).toEqual([])
    expect(world.store.read().entries).toHaveLength(1)
  })
})

describe('decline', () => {
  it('drops the ask', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    expect(world.service.decline({ askId: ask.askId })).toEqual({ type: 'done' })
    expect(await world.service.confirm({ askId: ask.askId, autoDelete: false })).toEqual(askGone)
    expect(world.store.read().entries).toEqual([])
  })
})

describe('setDefaults', () => {
  it("changes the default, answers the list and starts the next ask's choice from it", async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    expect(world.service.setDefaults({ autoDelete: true })).toEqual({
      type: 'downloads',
      downloads: [],
      autoDeleteDefault: true,
    })
    expect(world.store.read().autoDeleteDefault).toBe(true)
    expect((await askFor({ world, target: { kind: 'media', mediaId: 9 } })).autoDelete).toBe(true)
    world.fire()
    expect(downloadEvents(world.sent)).toEqual([
      { type: 'downloads', downloads: [], autoDeleteDefault: true },
    ])
  })
})

describe('list and views', () => {
  it("lists every download newest group first with its server's name", () => {
    const older = entryFor({
      downloadId: '00000000-0000-4000-8000-0000000000a1',
      mediaId: 41,
      label: 'Dune (2021)',
      group: { kind: 'movie', key: 'movie:41', title: 'Dune (2021)', order: 0 },
      createdAt: NOW - 5000,
      status: { kind: 'paused', bytes: 7, reason: 'viewer' },
      watchedAt: NOW - 100,
    })
    const newer = entryFor({ status: { kind: 'downloading', bytes: GIB }, autoDelete: true })
    const world = setup({
      initial: { ...EMPTY_DOWNLOADS, entries: [older, newer], autoDeleteDefault: true },
    })
    expect(world.service.list()).toEqual({
      type: 'downloads',
      downloads: [
        {
          downloadId: newer.downloadId,
          serverId: SERVER_ID,
          label: 'S01E01 Good News',
          group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_001 },
          serverName: 'Vhagar',
          size: 2 * GIB,
          status: { kind: 'downloading', bytes: GIB },
          autoDelete: true,
          watched: null,
          deletesAt: null,
          needsUnlock: false,
        },
        expect.objectContaining({ downloadId: older.downloadId, watched: null }),
      ],
      autoDeleteDefault: true,
    })
    expect(world.service.views()).toEqual(downloadsOf(world.service.list()).downloads)
  })

  it('carries no path, origin or media id to the page, only the server by its id', () => {
    const world = setup({ initial: { ...EMPTY_DOWNLOADS, entries: [entryFor({})] } })
    const text = JSON.stringify(world.service.list())
    expect(text).not.toContain('vhagar.example')
    expect(text).not.toContain('mediaId')
    expect(text).not.toContain(USER_DATA)
  })
})

describe('readSpace', () => {
  it('answers the free and total space and the bytes downloads hold', async () => {
    const world = setup({
      initial: {
        ...EMPTY_DOWNLOADS,
        entries: [
          entryFor({ size: 3 * GIB }),
          entryFor({
            downloadId: '00000000-0000-4000-8000-0000000000a1',
            mediaId: 12,
            status: { kind: 'downloading', bytes: GIB },
          }),
          entryFor({
            downloadId: '00000000-0000-4000-8000-0000000000a2',
            mediaId: 13,
            status: { kind: 'queued' },
          }),
        ],
      },
    })
    expect(await world.service.readSpace()).toEqual({
      type: 'space',
      space: { free: 412 * GIB, total: 1000 * GIB, used: 4 * GIB },
    })
    // The queue reads the same folder before it starts each file.
    expect(new Set(world.made)).toEqual(new Set([DOWNLOADS]))
  })
})

describe('the downloads event', () => {
  it('folds the changes of one quarter second into one list, sent after it', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) } })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    await world.service.confirm({ askId: ask.askId, autoDelete: false })
    world.service.setDefaults({ autoDelete: true })
    expect(downloadEvents(world.sent)).toEqual([])
    expect([...world.pending.values()].filter(({ ms }) => ms === DOWNLOADS_EVENT_MS)).toHaveLength(
      1,
    )
    world.fire()
    const events = downloadEvents(world.sent)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      autoDeleteDefault: true,
      downloads: [{ label: 'Fellowship (2001)' }],
    })
  })

  it('sends nothing for a change that changed nothing', () => {
    const world = setup()
    world.service.setDefaults({ autoDelete: false })
    world.fire()
    expect(world.sent).toEqual([])
  })

  it('sends nothing after dispose', () => {
    const world = setup()
    world.service.setDefaults({ autoDelete: true })
    world.service.dispose()
    expect([...world.pending.values()].filter(({ ms }) => ms === DOWNLOADS_EVENT_MS)).toEqual([])
    world.fire()
    expect(world.sent).toEqual([])
  })
})

describe('the queue', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
  const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff'
  const PART = `${DOWNLOADS}/${SERVER_ID}/11/video.mkv.part`
  const queuedFile = (overrides: Partial<DownloadEntry> = {}): DownloadEntry =>
    entryFor({ size: 8, status: { kind: 'queued' }, ...overrides })
  const holding = (...entries: DownloadEntry[]): DownloadsState => ({
    ...EMPTY_DOWNLOADS,
    entries,
  })
  const statusOf = (world: World, downloadId = ID) =>
    world.store.read().entries.find((entry) => entry.downloadId === downloadId)?.status ?? null

  it('resumes at launch what the last run left, from the bytes on disk', async () => {
    const world = setup({
      initial: holding(entryFor({ size: 8192, status: { kind: 'downloading', bytes: 4096 } })),
      access: async () => FAR_TICKET,
      disk: { [PART]: 4096 },
    })
    world.network.answers.file = serving({ size: 8192, sent: 0, isEnding: false })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=4096-' })
  })

  it('drops at launch the downloads of a server raven player no longer keeps', async () => {
    const world = setup({
      initial: holding(entryFor({}), entryFor({ downloadId: OTHER_ID, serverId: OTHER_SERVER_ID })),
      disk: { [`${DOWNLOADS}/${OTHER_SERVER_ID}/11/video.mkv`]: 8 },
    })
    await until(() => world.drive.removed.length === 1)
    expect(world.drive.removed).toEqual([`${DOWNLOADS}/${OTHER_SERVER_ID}`])
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([ID])
  })

  it('starts what a confirmation queues', async () => {
    const world = setup({ replies: { [mediaCall(9)]: ok(MOVIE) }, access: async () => FAR_TICKET })
    const ask = await askFor({ world, target: { kind: 'media', mediaId: 9 } })
    await world.service.confirm({ askId: ask.askId, autoDelete: false })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.url).toContain('/api/media/9/file?t=one')
  })

  it('hands pauseDownload to the queue, which stops the fetch, and answers the list', async () => {
    const world = setup({ initial: holding(queuedFile()), access: async () => FAR_TICKET })
    await until(() => world.network.fileRequests().length === 1)
    const reply = downloadsOf(await world.service.pause({ downloadId: ID }))
    expect(reply.downloads[0]?.status).toEqual({ kind: 'paused', bytes: 0, message: null })
    expect(world.network.fileRequests()[0]?.signal.aborted).toBe(true)
  })

  it('resumes and retries through the queue', async () => {
    const world = setup({
      initial: holding(
        queuedFile({ status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        queuedFile({
          downloadId: OTHER_ID,
          mediaId: 12,
          status: { kind: 'failed', bytes: 0, reason: 'other', message: 'x' },
        }),
      ),
      access: async () => FAR_TICKET,
    })
    expect(downloadsOf(world.service.resume({ downloadId: ID })).downloads).toContainEqual(
      expect.objectContaining({ downloadId: ID, status: { kind: 'queued' } }),
    )
    world.service.retry({ downloadId: OTHER_ID })
    await until(() => world.network.fileRequests().length === 2)
  })

  it('pauses all and resumes all', async () => {
    const world = setup({
      initial: holding(queuedFile(), queuedFile({ downloadId: OTHER_ID, mediaId: 12 })),
      access: async () => FAR_TICKET,
    })
    await until(() => world.network.fileRequests().length === 2)
    const paused = downloadsOf(await world.service.pauseAll())
    expect(paused.downloads.map(({ status }) => status.kind)).toEqual(['paused', 'paused'])
    const resumed = downloadsOf(world.service.resumeAll())
    expect(resumed.downloads.map(({ status }) => status.kind)).toEqual(['queued', 'queued'])
    await until(() => world.network.fileRequests().length === 4)
  })

  it('sets one download to delete once watched', () => {
    const world = setup({ initial: holding(entryFor({})) })
    const reply = downloadsOf(world.service.setAutoDelete({ downloadId: ID, autoDelete: true }))
    expect(reply.downloads[0]?.autoDelete).toBe(true)
    expect(world.store.read().entries[0]?.autoDelete).toBe(true)
  })

  it('refuses an action on a download it does not hold', async () => {
    const world = setup({ initial: holding(entryFor({})) })
    const unknown = { type: 'refused', message: DOWNLOAD_MESSAGES.unknown } as const
    expect(await world.service.pause({ downloadId: UNKNOWN_ID })).toEqual(unknown)
    expect(world.service.resume({ downloadId: UNKNOWN_ID })).toEqual(unknown)
    expect(world.service.retry({ downloadId: UNKNOWN_ID })).toEqual(unknown)
    expect(await world.service.remove({ downloadId: UNKNOWN_ID })).toEqual(unknown)
    expect(world.service.setAutoDelete({ downloadId: UNKNOWN_ID, autoDelete: true })).toEqual(
      unknown,
    )
  })

  it('removes a download and answers the list without it', async () => {
    const world = setup({
      initial: holding(entryFor({}), entryFor({ downloadId: OTHER_ID, mediaId: 12 })),
    })
    const reply = downloadsOf(await world.service.remove({ downloadId: ID }))
    expect(reply.downloads.map(({ downloadId }) => downloadId)).toEqual([OTHER_ID])
    expect(world.drive.removed).toContain(`${DOWNLOADS}/${SERVER_ID}/11`)
  })

  it('answers deleteAllDownloads with an empty list and removes the downloads folder', async () => {
    const world = setup({
      initial: {
        ...holding(entryFor({}), entryFor({ downloadId: OTHER_ID, mediaId: 12 })),
        autoDeleteDefault: true,
      },
    })
    expect(await world.service.removeAll()).toEqual({
      type: 'downloads',
      downloads: [],
      autoDeleteDefault: true,
    })
    expect(world.drive.removed).toContain(DOWNLOADS)
  })

  it("removes a server's downloads", async () => {
    const world = setup({ initial: holding(entryFor({})) })
    await world.service.removeServer({ serverId: SERVER_ID })
    expect(world.store.read().entries).toEqual([])
    expect(world.drive.removed).toContain(`${DOWNLOADS}/${SERVER_ID}`)
    expect(world.media.forgotten).toEqual([SERVER_ID])
  })

  it('shows the downloads folder, made first', async () => {
    const world = setup()
    expect(await world.service.showFolder()).toEqual({ type: 'done' })
    expect(world.shown).toEqual([DOWNLOADS])
    expect(world.made).toEqual([DOWNLOADS])
  })

  it('says Downloaded <label> when a file finishes', async () => {
    const world = setup({ initial: holding(queuedFile()), access: async () => FAR_TICKET })
    world.network.answers.file = serving({ size: 8 })
    await until(() => statusOf(world)?.kind === 'ready')
    expect(world.sent).toContainEqual({ type: 'notice', message: 'Downloaded S01E01 Good News' })
  })

  it('says Could not download <label>: <why> when a file fails', async () => {
    const world = setup({ initial: holding(queuedFile()), access: async () => FAR_TICKET })
    world.network.answers.file = () => ({ status: 404, body: null })
    await until(() => statusOf(world)?.kind === 'failed')
    expect(world.sent).toContainEqual({
      type: 'notice',
      message: `Could not download S01E01 Good News: ${EXPAND_MESSAGES.gone('Vhagar')}`,
    })
  })

  it('says nothing for a file the viewer paused', async () => {
    const world = setup({ initial: holding(queuedFile()), access: async () => FAR_TICKET })
    await until(() => world.network.fileRequests().length === 1)
    await world.service.pause({ downloadId: ID })
    await ticks(10)
    expect(world.sent.filter(({ type }) => type === 'notice')).toEqual([])
  })

  it('marks a row paused by a relock as needing the unlock, even once its server is renamed', () => {
    const world = setup({
      initial: holding(
        entryFor({ status: { kind: 'paused', bytes: 0, reason: 'relocked' } }),
        entryFor({
          downloadId: OTHER_ID,
          mediaId: 12,
          status: { kind: 'paused', bytes: 0, reason: 'viewer' },
        }),
      ),
    })
    expect(world.service.views().map(({ needsUnlock }) => needsUnlock)).toEqual([true, false])
    world.config.update((config) => ({
      ...config,
      servers: config.servers.map((server) => ({ ...server, name: 'Caraxes' })),
    }))
    const [relocked] = world.service.views()
    expect(relocked?.needsUnlock).toBe(true)
    expect(relocked?.status).toEqual({
      kind: 'paused',
      bytes: 0,
      message: DOWNLOAD_MESSAGES.relocked('Caraxes'),
    })
  })

  it("words each stopped row by its reason and its server's name", () => {
    const stopped = (n: number, status: EntryStatus): DownloadEntry =>
      entryFor({
        downloadId: `00000000-0000-4000-8000-0000000000b${n}`,
        mediaId: 20 + n,
        createdAt: NOW - n,
        status,
      })
    const world = setup({
      initial: holding(
        stopped(1, { kind: 'paused', bytes: 1, reason: 'viewer' }),
        stopped(2, { kind: 'paused', bytes: 2, reason: 'noSpace' }),
        stopped(3, { kind: 'paused', bytes: 3, reason: 'unreachable' }),
        stopped(4, { kind: 'failed', bytes: 4, reason: 'noSpace', message: '' }),
        stopped(5, { kind: 'failed', bytes: 5, reason: 'changed', message: '' }),
        stopped(6, { kind: 'failed', bytes: 6, reason: 'unauthorized', message: '' }),
        stopped(7, { kind: 'failed', bytes: 7, reason: 'unreachable', message: '' }),
        stopped(8, { kind: 'failed', bytes: 8, reason: 'gone', message: '' }),
        stopped(9, { kind: 'failed', bytes: 9, reason: 'other', message: 'write EIO' }),
      ),
    })
    expect(world.service.views().map(({ status }) => status)).toEqual([
      { kind: 'paused', bytes: 1, message: null },
      { kind: 'paused', bytes: 2, message: 'Not enough space' },
      { kind: 'paused', bytes: 3, message: 'Vhagar could not be reached' },
      { kind: 'failed', bytes: 4, message: 'Not enough space' },
      { kind: 'failed', bytes: 5, message: 'The file changed on the server' },
      { kind: 'failed', bytes: 6, message: 'Vhagar answered 401' },
      { kind: 'failed', bytes: 7, message: 'Vhagar could not be reached' },
      { kind: 'failed', bytes: 8, message: EXPAND_MESSAGES.gone('Vhagar') },
      { kind: 'failed', bytes: 9, message: 'write EIO' },
    ])
  })

  it('says the server is gone for a reason that names a server raven player no longer keeps', () => {
    expect(
      viewStatusOf({ status: { kind: 'paused', bytes: 0, reason: 'relocked' }, serverName: '' }),
    ).toEqual({ kind: 'paused', bytes: 0, message: SERVER_GONE })
    expect(
      viewStatusOf({
        status: { kind: 'failed', bytes: 0, reason: 'gone', message: '' },
        serverName: '',
      }),
    ).toEqual({ kind: 'failed', bytes: 0, message: SERVER_GONE })
    expect(
      viewStatusOf({ status: { kind: 'paused', bytes: 0, reason: 'noSpace' }, serverName: '' }),
    ).toEqual({ kind: 'paused', bytes: 0, message: 'Not enough space' })
  })

  it('requeues at launch what an outage stopped', async () => {
    const world = setup({
      initial: holding(queuedFile({ status: { kind: 'paused', bytes: 0, reason: 'unreachable' } })),
      access: async () => FAR_TICKET,
    })
    await until(() => world.network.fileRequests().length === 1)
    expect(statusOf(world)).toEqual({ kind: 'downloading', bytes: 0 })
  })

  it('stops its fetches on a sleep without a word, and starts them again after the wake', async () => {
    const world = setup({ initial: holding(queuedFile()), access: async () => FAR_TICKET })
    await until(() => world.network.fileRequests().length === 1)
    world.service.onSuspend()
    expect(world.network.fileRequests()[0]?.signal.aborted).toBe(true)
    await ticks(10)
    expect(statusOf(world)).toEqual({ kind: 'downloading', bytes: 0 })
    world.service.onResume()
    const settle = [...world.pending].find(([, timer]) => timer.ms === RESUME_SETTLE_MS)
    expect(settle).toBeDefined()
    world.pending.delete(settle?.[0] ?? 0)
    settle?.[1].run()
    await until(() => world.network.fileRequests().length === 2)
    expect(world.sent.filter(({ type }) => type === 'notice')).toEqual([])
  })

  it('sends no downloads event after dispose, even as its fetches stop', async () => {
    const world = setup({ initial: holding(queuedFile()), access: async () => FAR_TICKET })
    await until(() => world.network.fileRequests().length === 1)
    world.service.dispose()
    expect(world.network.fileRequests()[0]?.signal.aborted).toBe(true)
    await ticks(10)
    world.fire()
    expect(world.sent).toEqual([])
    expect(statusOf(world)).toEqual({ kind: 'downloading', bytes: 0 })
  })
})

describe('playing a download', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
  const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff'
  const MOVIE_PATH = '/Movies/x.mkv'
  const videoOf = (mediaId: number, serverId = SERVER_ID): string =>
    `${DOWNLOADS}/${serverId}/${mediaId}/video.mkv`
  const VIDEO = videoOf(11)
  const FILE: Video = { size: 2 * GIB, mtimeMs: MTIME }
  const holding = (...entries: DownloadEntry[]): DownloadsState => ({
    ...EMPTY_DOWNLOADS,
    entries,
  })
  const shelved = (...entries: DownloadEntry[]): Record<string, Video> =>
    Object.fromEntries(
      entries.map((entry) => [
        videoOf(entry.mediaId, entry.serverId),
        { size: entry.size, mtimeMs: MTIME },
      ]),
    )
  const episodeOf = (n: number, overrides: Partial<DownloadEntry> = {}): DownloadEntry =>
    entryFor({
      downloadId: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
      mediaId: 10 + n,
      label: `Episode ${n}`,
      group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_000 + n },
      ...overrides,
    })
  const factsOf = (path: string, video: Video = FILE): FileFacts => ({ path, ...video })
  const pathOf = (world: World, fileId: string): string | null =>
    world.grants.fileOf(fileId)?.path ?? null
  const targetOf = (reply: DesktopReply) => {
    if (reply.type !== 'play') throw new Error(`expected play, got ${reply.type}`)
    return reply.target
  }
  const opened = async (world: World, downloadId = ID): Promise<string> =>
    targetOf(await world.service.open({ downloadId })).fileId
  /** A grant made outside `open`, as Home's recents, a drop or the open dialog make one. */
  const granted = async (world: World, path: string): Promise<string> => {
    const result = await world.grants.grant(path)
    if (!result.ok) throw new Error(`expected a grant, got ${result.reason}`)
    return result.file.fileId
  }
  const entryOf = (world: World, downloadId = ID) =>
    world.store.read().entries.find((entry) => entry.downloadId === downloadId) ?? null
  const lastList = (world: World) => {
    const last = world.sent.findLast((event) => event.type === 'downloads')
    if (last?.type !== 'downloads') throw new Error('expected a downloads event')
    return last.downloads
  }
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

  it("plays a ready download as a local file, with its group's later ready files queued in order", async () => {
    const movie = entryFor({
      downloadId: '00000000-0000-4000-9000-0000000000aa',
      mediaId: 41,
      label: 'Dune (2021)',
      group: { kind: 'movie', key: 'movie:41', title: 'Dune (2021)', order: 0 },
    })
    const ready = [episodeOf(3), episodeOf(1), episodeOf(2), episodeOf(5), movie]
    const world = setup({
      initial: holding(...ready, episodeOf(4, { status: { kind: 'queued' } })),
      videos: shelved(...ready),
    })
    const target = targetOf(await world.service.open({ downloadId: episodeOf(2).downloadId }))
    expect(isOpaqueId(target.fileId)).toBe(true)
    expect(pathOf(world, target.fileId)).toBe(videoOf(12))
    expect(target.queue.map((fileId) => pathOf(world, fileId))).toEqual([videoOf(13), videoOf(15)])
  })

  it('queues at most MAX_QUEUE files after the one it plays', async () => {
    const entries = Array.from({ length: MAX_QUEUE + 2 }, (_, index) => episodeOf(index + 1))
    const world = setup({ initial: holding(...entries), videos: shelved(...entries) })
    const target = targetOf(await world.service.open({ downloadId: episodeOf(1).downloadId }))
    expect(target.queue).toHaveLength(MAX_QUEUE)
    expect(pathOf(world, target.queue.at(-1) ?? '')).toBe(videoOf(11 + MAX_QUEUE))
  })

  it('refuses a download that is not ready, and one it does not hold', async () => {
    const world = setup({
      initial: holding(entryFor({ status: { kind: 'paused', bytes: 7, reason: 'viewer' } })),
      videos: { [VIDEO]: FILE },
    })
    const unknown = { type: 'refused', message: DOWNLOAD_MESSAGES.unknown } as const
    expect(await world.service.open({ downloadId: ID })).toEqual(unknown)
    expect(await world.service.open({ downloadId: UNKNOWN_ID })).toEqual(unknown)
  })

  it('refuses a download whose file has gone, and warns by its title alone', async () => {
    const world = setup({ initial: holding(entryFor({})) })
    expect(await world.service.open({ downloadId: ID })).toEqual({
      type: 'refused',
      message: DOWNLOAD_MESSAGES.fileGone,
    })
    expect(world.warnings).toEqual([expect.stringContaining('S01E01 Good News')])
    expect(world.warnings.join('\n')).not.toContain('video.mkv')
  })

  it('leaves out of the queue a file that has gone, and warns by its title alone', async () => {
    const world = setup({
      initial: holding(episodeOf(1), episodeOf(2), episodeOf(3)),
      videos: shelved(episodeOf(1), episodeOf(3)),
    })
    const target = targetOf(await world.service.open({ downloadId: episodeOf(1).downloadId }))
    expect(target.queue.map((fileId) => pathOf(world, fileId))).toEqual([videoOf(13)])
    expect(world.warnings).toEqual([expect.stringContaining('Episode 2')])
    expect(world.warnings.join('\n')).not.toContain('video.mkv')
  })

  it("lists a download's subtitles under its subtitles folder, and none for another file", async () => {
    const world = setup({
      initial: holding(
        entryFor({
          sidecars: [
            { trackId: 'external-0', title: 'English', language: 'en' },
            { trackId: 'external-2', title: 'Forced', language: 'en' },
          ],
        }),
      ),
      videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE },
    })
    const fileId = await opened(world)
    expect(world.service.sidecarsOf(fileId)).toEqual([
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
    expect(world.service.sidecarsOf(await granted(world, MOVIE_PATH))).toEqual([])
    expect(world.service.sidecarsOf(UNKNOWN_ID)).toEqual([])
  })

  it("says a download came from its server by the server's name now, and nothing for another file", () => {
    const world = setup({ initial: holding(entryFor({})) })
    expect(world.service.fromLabelOf({ path: VIDEO })).toBe('Downloaded from Vhagar')
    expect(world.service.fromLabelOf({ path: MOVIE_PATH })).toBeNull()
    expect(world.service.fromLabelOf({ path: `${DOWNLOADS}/../Movies/x.mkv` })).toBeNull()
    expect(world.service.fromLabelOf({ path: videoOf(11, OTHER_SERVER_ID) })).toBeNull()
    world.config.update((config) => ({
      ...config,
      servers: config.servers.map((server) => ({ ...server, name: 'Caraxes' })),
    }))
    expect(world.service.fromLabelOf({ path: VIDEO })).toBe('Downloaded from Caraxes')
  })

  it("names a download's video by its title, and nothing for another file", () => {
    const world = setup({ initial: holding(entryFor({})) })
    expect(world.service.labelOf({ path: VIDEO })).toBe('S01E01 Good News')
    expect(world.service.labelOf({ path: MOVIE_PATH })).toBeNull()
  })

  it('counts the first position after an open as a play, and notes every position', async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.clock.now = NOW + 1
    world.service.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: true, position: 100, at: NOW + 1 })
    // What a sync sent is cleared, so a second play would show.
    world.store.update((state) => clearPending(state, { downloadId: ID, sentPosition: 100 }))
    world.clock.now = NOW + 2
    world.service.notePosition({ fileId, position: 200, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: false, position: 200, at: NOW + 2 })
    expect(await opened(world)).toBe(fileId)
    world.service.notePosition({ fileId, position: 300, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: true, position: 300, at: NOW + 2 })
  })

  it("marks a download watched once a position reaches its library's Watched at, and keeps the first time", async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.service.notePosition({ fileId, position: 2699, duration: null })
    expect(entryOf(world)?.watchedAt).toBeNull()
    world.clock.now = NOW + 5
    world.service.notePosition({ fileId, position: 2700, duration: null })
    expect(entryOf(world)?.watchedAt).toBe(NOW + 5)
    world.clock.now = NOW + 9
    world.service.notePosition({ fileId, position: 2990, duration: 3000 })
    expect(entryOf(world)?.watchedAt).toBe(NOW + 5)
  })

  it("reads the player's length before the entry's", async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    world.service.notePosition({ fileId, position: 900, duration: 1000 })
    expect(entryOf(world)?.watchedAt).toBe(NOW)
  })

  it('knows a download opened outside the Downloads page by its path, and counts a play once the page opens it', async () => {
    const world = setup({
      initial: holding(
        entryFor({ sidecars: [{ trackId: 'external-0', title: 'English', language: 'en' }] }),
      ),
      videos: { [VIDEO]: FILE },
    })
    const fileId = await granted(world, VIDEO)
    expect(world.service.sidecarsOf(fileId)).toHaveLength(1)
    world.service.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: false, position: 100, at: NOW })
    world.service.noteOpened({ fileId })
    world.service.notePosition({ fileId, position: 150, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: true, position: 150, at: NOW })
  })

  it('reaches a download removed and downloaded again at the same path', async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    const fileId = await opened(world)
    await world.service.remove({ downloadId: ID })
    const again = entryFor({
      downloadId: OTHER_ID,
      sidecars: [{ trackId: 'external-0', title: 'English', language: 'en' }],
    })
    world.store.update((state) => ({ ...state, entries: [again] }))
    world.service.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world, OTHER_ID)?.pending.position).toBe(100)
    expect(world.service.sidecarsOf(fileId)).toHaveLength(1)
  })

  it('forgets a file whose download was removed while it was granted', async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    const held = Promise.withResolvers<void>()
    world.granting.hold = held.promise
    const opening = world.service.open({ downloadId: ID })
    await world.service.remove({ downloadId: ID })
    held.resolve()
    const { fileId } = targetOf(await opening)
    world.service.notePosition({ fileId, position: 50, duration: 3000 })
    world.store.update((state) => ({ ...state, entries: [entryFor({ downloadId: OTHER_ID })] }))
    world.service.notePosition({ fileId, position: 100, duration: 3000 })
    expect(entryOf(world, OTHER_ID)?.pending.position).toBe(100)
  })

  it('notes nothing for a file that is not a download', async () => {
    const world = setup({
      initial: holding(entryFor({})),
      videos: { [VIDEO]: FILE, [MOVIE_PATH]: FILE },
    })
    const before = world.store.read()
    const fileId = await granted(world, MOVIE_PATH)
    world.service.noteOpened({ fileId })
    world.service.notePosition({ fileId, position: 2900, duration: 3000 })
    world.service.notePosition({ fileId: UNKNOWN_ID, position: 2900, duration: 3000 })
    expect(world.store.read()).toBe(before)
  })

  it.each([
    ['remove', (world: World) => world.service.remove({ downloadId: ID })],
    ['removeServer', (world: World) => world.service.removeServer({ serverId: SERVER_ID })],
    ['removeAll', (world: World) => world.service.removeAll()],
  ])("drops a download's recent and resume spot through %s", async (_, removing) => {
    const world = setup({
      initial: holding(entryFor({})),
      videos: { [VIDEO]: FILE },
      player: remembering(VIDEO, MOVIE_PATH),
    })
    await opened(world)
    await removing(world)
    expect(pathsIn(world.state.read())).toEqual({ recents: [MOVIE_PATH], resume: [MOVIE_PATH] })
  })

  it('drops at launch the recent and resume spot of a download of a server raven player no longer keeps', async () => {
    const path = videoOf(11, OTHER_SERVER_ID)
    const world = setup({
      initial: holding(entryFor({ serverId: OTHER_SERVER_ID })),
      player: remembering(path, MOVIE_PATH),
    })
    await until(() => world.store.read().entries.length === 0)
    expect(pathsIn(world.state.read())).toEqual({ recents: [MOVIE_PATH], resume: [MOVIE_PATH] })
  })

  it('leaves the player state as it was when nothing names the removed download', async () => {
    const player = remembering(MOVIE_PATH)
    const world = setup({ initial: holding(entryFor({})), player })
    await world.service.remove({ downloadId: ID })
    expect(world.state.read()).toBe(player)
  })

  it("shows each ready file's share watched, read off its file at launch", async () => {
    const replaced = videoOf(12)
    const player = [
      { file: factsOf(VIDEO), position: 1500 },
      { file: factsOf(replaced, { size: 2 * GIB, mtimeMs: MTIME - 1 }), position: 1500 },
      { file: factsOf(videoOf(13)), position: 1500 },
    ].reduce(
      (state, { file, position }) => savePosition({ state, file, position, duration: 3000, at: 1 }),
      EMPTY_STATE,
    )
    const ready = [
      entryFor({}),
      entryFor({
        downloadId: OTHER_ID,
        mediaId: 12,
        group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_002 },
      }),
    ]
    const paused = entryFor({
      downloadId: UNKNOWN_ID,
      mediaId: 13,
      group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_003 },
      status: { kind: 'paused', bytes: 7, reason: 'viewer' },
    })
    const world = setup({
      initial: holding(...ready, paused),
      videos: { ...shelved(...ready), [videoOf(13)]: FILE },
      player,
    })
    await until(() => world.service.views()[0]?.watched !== null)
    expect(world.service.views().map(({ watched }) => watched)).toEqual([0.5, null, null])
    expect(world.statted.toSorted()).toEqual([VIDEO, replaced])
    world.fire()
    expect(lastList(world).map(({ watched }) => watched)).toEqual([0.5, null, null])
  })

  it('shows the share a noted position leaves, and tells the page', async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    await until(() => world.statted.length === 1)
    const fileId = await opened(world)
    world.state.update((state) =>
      savePosition({ state, file: factsOf(VIDEO), position: 750, duration: 3000, at: NOW }),
    )
    world.service.notePosition({ fileId, position: 750, duration: 3000 })
    expect(world.service.views()[0]?.watched).toBe(0.25)
    world.fire()
    expect(lastList(world)[0]?.watched).toBe(0.25)
  })

  it("reads a finished file's facts, so its share shows once a position is saved", async () => {
    const world = setup({
      initial: holding(entryFor({ size: 8, status: { kind: 'queued' } })),
      access: async () => FAR_TICKET,
      player: savePosition({
        state: EMPTY_STATE,
        file: factsOf(VIDEO, { size: 8, mtimeMs: MTIME }),
        position: 1500,
        duration: 3000,
        at: 1,
      }),
    })
    world.network.answers.file = serving({ size: 8 })
    await until(() => world.service.views()[0]?.watched !== null)
    expect(world.service.views()[0]?.watched).toBe(0.5)
  })
})
