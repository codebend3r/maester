import { describe, expect, it } from 'bun:test'
import { LOCKED_STATUS, type DownloadTarget, type MediaItem, type Saga } from '@raven/core'
import { EMPTY_CONFIG, type ConfigStore, type DesktopConfig } from '@/main/desktopConfig'
import { ASK_TTL_MS } from '@/main/downloads/asks'
import { AUTO_DELETE_DELAY_MS } from '@/main/downloads/autoDelete'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  createDownloadService,
  DOWNLOADS_EVENT_MS,
  SYNC_DELETE_WAIT_MS,
  viewStatusOf,
} from '@/main/downloads/downloadService'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
  type EntryStatus,
} from '@/main/downloads/downloadState'
import { RESUME_SETTLE_MS } from '@/main/downloads/downloadQueue'
import { DOWNLOADS_DEBOUNCE_MS } from '@/main/downloads/downloadStore'
import { SYNC_DEBOUNCE_MS, SYNC_RETRY_MS } from '@/main/downloads/sync'
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
import { SERVER_GONE, type DesktopEvent, type DesktopReply } from '@/shared/protocol'
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
    episode({
      id: 52,
      season: 1,
      number: 2,
      title: 'Half Loop',
      primary: { ...episodeFile(12), position: 4200 },
    }),
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
  serverPosition: 0,
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
  startAt = NOW,
  isPageReady = true,
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
  /** What the clock reads at launch. */
  startAt?: number
  /** Whether the page says ready at once, as it does a moment after every launch. */
  isPageReady?: boolean
} = {}) => {
  const table: Record<string, Reply> = {
    [libraryCall]: ok(library({ id: 1, watchedPercent: 90 })),
    ...replies,
  }
  const { calls: answering, log } = fakeCalls(table)
  /** Server calls wait on this before they are answered, so a test can leave the server silent. */
  const silence: { until: Promise<void> } = { until: Promise.resolve() }
  const calls: typeof answering = {
    call: async (input) => {
      await silence.until
      return answering.call(input)
    },
  }
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
  const clock = { now: startAt }
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
  const grants = createGrants({
    fs: {
      realpath: async (path) => {
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
  if (isPageReady) service.pageReady()
  return {
    service,
    store,
    grants,
    state,
    shelf,
    statted,
    config,
    table,
    log,
    silence,
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
        serverPosition: 4200,
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
        // Marked watched, so watched whole, though no file was read for its share.
        expect.objectContaining({ downloadId: older.downloadId, watched: 1 }),
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
  const MOVIE_PATH = '/Movies/x.mkv'
  const videoOf = (mediaId: number, serverId = SERVER_ID): string =>
    `${DOWNLOADS}/${serverId}/${mediaId}/video.mkv`
  const VIDEO = videoOf(11)
  const FILE: Video = { size: 2 * GIB, mtimeMs: MTIME }
  const holding = (...entries: DownloadEntry[]): DownloadsState => ({
    ...EMPTY_DOWNLOADS,
    entries,
  })
  const factsOf = (path: string, video: Video = FILE): FileFacts => ({ path, ...video })
  const targetOf = (reply: DesktopReply) => {
    if (reply.type !== 'play') throw new Error(`expected play, got ${reply.type}`)
    return reply.target
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

  it('plays a download through its playback, and tells the page what a position changed', async () => {
    const world = setup({
      initial: holding(
        entryFor({ sidecars: [{ trackId: 'external-0', title: 'English', language: 'en' }] }),
      ),
      videos: { [VIDEO]: FILE },
    })
    const { fileId, queue } = targetOf(await world.service.open({ downloadId: ID }))
    expect(world.grants.fileOf(fileId)?.path).toBe(VIDEO)
    expect(queue).toEqual([])
    expect(world.service.sidecarsOf(fileId)).toHaveLength(1)
    expect(world.service.fromLabelOf({ path: VIDEO })).toBe('Downloaded from Vhagar')
    expect(world.service.labelOf({ path: VIDEO })).toBe('S01E01 Good News')
    world.service.noteOpened({ fileId })
    world.service.notePlaying({ fileId })
    world.state.update((state) =>
      savePosition({ state, file: factsOf(VIDEO), position: 750, duration: 3000, at: NOW }),
    )
    world.service.notePosition({ fileId, position: 750, duration: 3000 })
    expect(entryOf(world)?.pending).toEqual({ play: true, position: 750, furthest: 750, at: NOW })
    expect(world.service.views()[0]?.watched).toBe(0.25)
    world.fire()
    expect(lastList(world)[0]?.watched).toBe(0.25)
  })

  it('reads a download watched to its end as watched whole, though the end dropped its resume spot', async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    const { fileId } = targetOf(await world.service.open({ downloadId: ID }))
    world.state.update((state) =>
      savePosition({ state, file: factsOf(VIDEO), position: 2995, duration: 3000, at: NOW }),
    )
    world.service.notePosition({ fileId, position: 2995, duration: 3000 })
    expect(world.state.read().resume).toEqual([])
    expect(entryOf(world)?.watchedAt).toBe(NOW)
    expect(world.service.views()[0]?.watched).toBe(1)
    expect(world.service.isWatched({ path: VIDEO })).toBe(true)
    expect(world.service.isWatched({ path: MOVIE_PATH })).toBe(false)
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
    const paused = entryFor({
      downloadId: '00000000-0000-4000-8000-0000000000ff',
      mediaId: 13,
      group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_003 },
      status: { kind: 'paused', bytes: 7, reason: 'viewer' },
    })
    const world = setup({
      initial: holding(
        entryFor({}),
        entryFor({
          downloadId: OTHER_ID,
          mediaId: 12,
          group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_002 },
        }),
        paused,
      ),
      videos: { [VIDEO]: FILE, [replaced]: FILE, [videoOf(13)]: FILE },
      player,
    })
    await until(() => world.service.views()[0]?.watched !== null)
    expect(world.service.views().map(({ watched }) => watched)).toEqual([0.5, null, null])
    expect(world.statted.toSorted()).toEqual([VIDEO, replaced])
    world.fire()
    expect(lastList(world).map(({ watched }) => watched)).toEqual([0.5, null, null])
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

describe('reaching the server', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
  const VIDEO = `${DOWNLOADS}/${SERVER_ID}/11/video.mkv`
  const OTHER_VIDEO = `${DOWNLOADS}/${SERVER_ID}/12/video.mkv`
  const FILE: Video = { size: 2 * GIB, mtimeMs: MTIME }
  const PLAYED = { play: true, position: 750, furthest: 750, at: NOW }
  const progress = (mediaId: number, position: number): string =>
    keyOf({ name: 'saveProgress', mediaId, position })
  const playOf = (mediaId: number): string => keyOf({ name: 'recordPlay', mediaId })
  const NO_CONTENT: Reply = { status: 204, body: '' }
  const holding = (...entries: DownloadEntry[]): DownloadsState => ({
    ...EMPTY_DOWNLOADS,
    entries,
  })
  const withPending = (overrides: Partial<DownloadEntry> = {}): DownloadEntry =>
    entryFor({ pending: PLAYED, ...overrides })
  const entries = (world: World) => world.store.read().entries
  /** Runs the timers set for this long, and no others. */
  const fireAfter = (world: World, ms: number): void => {
    const due = [...world.pending].filter(([, timer]) => timer.ms === ms)
    due.forEach(([handle, timer]) => {
      world.pending.delete(handle)
      timer.run()
    })
  }

  it('sends what a position saved for a download left pending, once the debounce has run', async () => {
    const world = setup({
      initial: holding(entryFor({})),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: NO_CONTENT, [progress(11, 750)]: NO_CONTENT },
    })
    // The launch sends what is pending once, so the position is saved after it.
    await ticks(10)
    const granted = await world.grants.grant(VIDEO)
    if (!granted.ok) throw new Error('expected a grant')
    world.service.noteOpened({ fileId: granted.file.fileId })
    world.service.notePosition({ fileId: granted.file.fileId, position: 750, duration: 3000 })
    await ticks(5)
    expect(world.log).toEqual([])
    fireAfter(world, SYNC_DEBOUNCE_MS)
    await until(() => world.log.length === 2)
    expect(world.log).toEqual([playOf(11), progress(11, 750)])
    await until(() => entries(world)[0]?.pending.position === null)
    expect(entries(world)[0]?.pending.play).toBe(false)
  })

  it('sends at launch what the last run left pending', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: NO_CONTENT, [progress(11, 750)]: NO_CONTENT },
    })
    await until(() => world.log.length === 2)
    expect(world.log).toEqual([playOf(11), progress(11, 750)])
    await until(() => entries(world)[0]?.pending.position === null)
  })

  it('sends again when the Downloads page is listed, but not for the list an event carries', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: { unreachable: 'offline' } },
    })
    await until(() => world.log.length === 1)
    await ticks(3)
    fireAfter(world, DOWNLOADS_EVENT_MS)
    await ticks(5)
    expect(world.log).toEqual([playOf(11)])
    world.table[playOf(11)] = NO_CONTENT
    world.table[progress(11, 750)] = NO_CONTENT
    world.service.list()
    await until(() => world.log.length === 3)
    expect(world.log.slice(1)).toEqual([playOf(11), progress(11, 750)])
  })

  it('tries again after SYNC_RETRY_MS while something is pending', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: { unreachable: 'offline' } },
    })
    await until(() => world.log.length === 1)
    await ticks(3)
    expect([...world.pending.values()].some(({ ms }) => ms === SYNC_RETRY_MS)).toBe(true)
    world.table[playOf(11)] = NO_CONTENT
    world.table[progress(11, 750)] = NO_CONTENT
    fireAfter(world, SYNC_RETRY_MS)
    await until(() => entries(world)[0]?.pending.position === null)
  })

  it('deletes within the wait when its server stays silent', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
    })
    world.silence.until = new Promise(() => undefined)
    const removing = world.service.remove({ downloadId: ID })
    await ticks(5)
    expect(entries(world)).toHaveLength(1)
    expect([...world.pending.values()].some(({ ms }) => ms === SYNC_DELETE_WAIT_MS)).toBe(true)
    world.fire()
    await removing
    expect(entries(world)).toEqual([])
  })

  it('sends a download its pending position before it deletes it', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: NO_CONTENT, [progress(11, 750)]: NO_CONTENT },
    })
    const release: { open: () => void } = { open: () => undefined }
    world.silence.until = new Promise((resolve) => {
      release.open = resolve
    })
    const removing = world.service.remove({ downloadId: ID })
    await ticks(5)
    expect(entries(world)).toHaveLength(1)
    release.open()
    await removing
    expect(world.log).toEqual([playOf(11), progress(11, 750)])
    expect(entries(world)).toEqual([])
  })

  it('sends every pending position before it deletes all, and still deletes when the server stays silent', async () => {
    const world = setup({
      initial: holding(
        withPending(),
        withPending({ downloadId: OTHER_ID, mediaId: 12, pending: PLAYED }),
      ),
      videos: { [VIDEO]: FILE, [OTHER_VIDEO]: FILE },
    })
    world.silence.until = new Promise(() => undefined)
    const removing = world.service.removeAll()
    await ticks(5)
    expect(entries(world)).toHaveLength(2)
    world.fire()
    await removing
    expect(entries(world)).toEqual([])
  })

  it('owes the server what a Delete removed while it was unreachable, and sends it at the retry', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: { unreachable: 'offline' } },
    })
    await world.service.remove({ downloadId: ID })
    expect(world.store.read()).toMatchObject({
      entries: [],
      owed: [{ serverId: SERVER_ID, mediaId: 11, pending: PLAYED }],
    })
    world.table[playOf(11)] = NO_CONTENT
    world.table[progress(11, 750)] = NO_CONTENT
    const before = world.log.length
    fireAfter(world, SYNC_RETRY_MS)
    await until(() => world.store.read().owed.length === 0)
    expect(world.log.slice(before)).toEqual([playOf(11), progress(11, 750)])
  })

  it('owes nothing for a download deleted with nothing pending', async () => {
    const world = setup({ initial: holding(entryFor({})), videos: { [VIDEO]: FILE } })
    await world.service.remove({ downloadId: ID })
    expect(world.store.read()).toMatchObject({ entries: [], owed: [] })
  })

  it('drops what a removed server was owed, and sends it nothing', async () => {
    const world = setup({
      initial: { ...holding(), owed: [{ serverId: SERVER_ID, mediaId: 11, pending: PLAYED }] },
      replies: { [playOf(11)]: { unreachable: 'offline' } },
    })
    await world.service.removeServer({ serverId: SERVER_ID })
    expect(world.store.read().owed).toEqual([])
    const before = world.log.length
    await world.service.removeAll()
    expect(world.log.length).toBe(before)
  })

  it('does not wait on the server to forget a server', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
    })
    world.silence.until = new Promise(() => undefined)
    await world.service.removeServer({ serverId: SERVER_ID })
    expect(entries(world)).toEqual([])
  })

  it('sends nothing more after dispose', async () => {
    const world = setup({
      initial: holding(withPending()),
      videos: { [VIDEO]: FILE },
      replies: { [playOf(11)]: { unreachable: 'offline' } },
    })
    await until(() => world.log.length === 1)
    await ticks(3)
    world.service.dispose()
    world.fire()
    world.service.list()
    await ticks(5)
    expect(world.log).toEqual([playOf(11)])
    expect(world.pending.size).toBe(0)
  })
})

describe('deleting once watched', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const MINUTE = 60_000
  const VIDEO = `${DOWNLOADS}/${SERVER_ID}/11/video.mkv`
  const FILE: Video = { size: 2 * GIB, mtimeMs: MTIME }
  const NO_CONTENT: Reply = { status: 204, body: '' }
  const PLAY = keyOf({ name: 'recordPlay', mediaId: 11 })
  const PROGRESS = keyOf({ name: 'saveProgress', mediaId: 11, position: 0 })
  const DELETED = { type: 'notice', message: 'Deleted S01E01 Good News after watching' } as const
  const holding = (...entries: DownloadEntry[]): DownloadsState => ({
    ...EMPTY_DOWNLOADS,
    entries,
  })
  const settingUp = (
    entry: Partial<DownloadEntry>,
    { isPageReady = true }: { isPageReady?: boolean } = {},
  ) =>
    setup({
      initial: holding(entryFor({ autoDelete: true, ...entry })),
      videos: { [VIDEO]: FILE },
      replies: { [PLAY]: NO_CONTENT, [PROGRESS]: NO_CONTENT },
      isPageReady,
    })
  const entries = (world: World) => world.store.read().entries
  /** Runs the timers set for this long, and no others. */
  const fireAfter = (world: World, ms: number): void => {
    const due = [...world.pending].filter(([, timer]) => timer.ms === ms)
    due.forEach(([handle, timer]) => {
      world.pending.delete(handle)
      timer.run()
    })
  }
  /** Lets `ms` go by on the clock, then runs the timers set for that long. */
  const after = (world: World, ms: number): void => {
    world.clock.now += ms
    fireAfter(world, ms)
  }
  const delays = (world: World) => [...world.pending.values()].map(({ ms }) => ms)
  const lastList = (world: World) => {
    const last = world.sent.findLast((event) => event.type === 'downloads')
    if (last?.type !== 'downloads') throw new Error('expected a downloads event')
    return last.downloads
  }
  /** Opens the download as the Downloads page's Play does, and the play page describes it. */
  const play = async (world: World): Promise<string> => {
    const reply = await world.service.open({ downloadId: ID })
    if (reply.type !== 'play') throw new Error(`expected play, got ${reply.type}`)
    world.service.noteOpened({ fileId: reply.target.fileId })
    return reply.target.fileId
  }
  /** Saves a position as the play page's savePosition does: the player state, then the download. */
  const reach = (world: World, { fileId, position }: { fileId: string; position: number }) => {
    world.state.update((state) =>
      savePosition({
        state,
        file: { path: VIDEO, ...FILE },
        position,
        duration: 3000,
        at: world.clock.now,
      }),
    )
    world.service.notePosition({ fileId, position, duration: 3000 })
  }

  it('deletes a download ten minutes after it counts as watched, once its page has left it', async () => {
    const world = settingUp({})
    await ticks(10)
    const fileId = await play(world)
    reach(world, { fileId, position: 2800 })
    expect(world.service.views()[0]?.deletesAt).toBe(NOW + AUTO_DELETE_DELAY_MS)
    world.service.playbackLeft({ fileId })
    after(world, AUTO_DELETE_DELAY_MS)
    await until(() => entries(world).length === 0)
    // What was watched reaches the server before the file goes.
    expect(world.log).toEqual([PLAY, PROGRESS])
    expect(world.sent).toContainEqual(DELETED)
    fireAfter(world, DOWNLOADS_EVENT_MS)
    expect(lastList(world)).toEqual([])
  })

  it('deletes at once at launch a download watched more than ten minutes before', async () => {
    const world = settingUp({ watchedAt: NOW - 11 * MINUTE })
    await until(() => entries(world).length === 0)
    expect(world.sent).toContainEqual(DELETED)
  })

  it("starts the launch's clocks only once the page says ready, so it hears the notice", async () => {
    const world = settingUp({ watchedAt: NOW - 11 * MINUTE }, { isPageReady: false })
    await ticks(20)
    expect(entries(world)).toHaveLength(1)
    expect(world.sent).not.toContainEqual(DELETED)
    world.service.pageReady()
    await until(() => entries(world).length === 0)
    expect(world.sent).toContainEqual(DELETED)
    world.service.pageReady()
    await ticks(10)
    expect(world.sent.filter((event) => event.type === 'notice')).toEqual([DELETED])
  })

  it('resumes the clock at launch with what is left, and the row says when', async () => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    expect(world.service.views()[0]?.deletesAt).toBe(NOW + 7 * MINUTE)
    expect(delays(world)).toContain(7 * MINUTE)
    fireAfter(world, DOWNLOADS_EVENT_MS)
    expect(lastList(world)[0]?.deletesAt).toBe(NOW + 7 * MINUTE)
  })

  it('deletes at once after a sleep that outlasted its ten minutes, once the wake has settled', async () => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    world.service.onSuspend()
    // The clock's timer stood still for the hour the Mac slept.
    world.clock.now += 60 * MINUTE
    world.service.onResume()
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    fireAfter(world, RESUME_SETTLE_MS)
    await until(() => entries(world).length === 0)
    expect(world.sent).toContainEqual(DELETED)
    expect(delays(world)).not.toContain(7 * MINUTE)
  })

  it('starts the ten minutes from the switch for a title already watched, and stops them when switched off', async () => {
    const world = settingUp({ autoDelete: false, watchedAt: NOW - 30 * MINUTE })
    await ticks(10)
    const on = downloadsOf(world.service.setAutoDelete({ downloadId: ID, autoDelete: true }))
    expect(on.downloads[0]?.deletesAt).toBe(NOW + AUTO_DELETE_DELAY_MS)
    await ticks(5)
    expect(entries(world)).toHaveLength(1)
    const off = downloadsOf(world.service.setAutoDelete({ downloadId: ID, autoDelete: false }))
    expect(off.downloads[0]?.deletesAt).toBeNull()
    expect(delays(world)).not.toContain(AUTO_DELETE_DELAY_MS)
  })

  it('holds a deletion while the html engine plays its file, and runs it once the page leaves', async () => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    const fileId = await play(world)
    after(world, 7 * MINUTE)
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    world.service.playbackLeft({ fileId: '00000000-0000-4000-8000-0000000000ff' })
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    world.service.playbackLeft({ fileId })
    await until(() => entries(world).length === 0)
    expect(world.sent).toContainEqual(DELETED)
  })

  it('keeps a deletion held while the page plays its file though the engine stopped, until the page leaves', async () => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    const fileId = await play(world)
    world.service.notePlaying({ fileId })
    after(world, 7 * MINUTE)
    await ticks(10)
    world.service.notePlaying({ fileId: null })
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    world.service.playbackLeft({ fileId })
    await until(() => entries(world).length === 0)
    expect(world.sent).toContainEqual(DELETED)
  })

  it('runs a deletion held for the file the engine plays once the engine is on nothing of this computer', async () => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    const fileId = await play(world)
    world.service.notePlaying({ fileId })
    world.service.playbackLeft({ fileId })
    after(world, 7 * MINUTE)
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    world.service.notePlaying({ fileId: null })
    await until(() => entries(world).length === 0)
  })

  it('keeps a title scrubbed back to its middle, and deletes it once it is played to its end', async () => {
    const world = settingUp({})
    await ticks(10)
    const fileId = await play(world)
    reach(world, { fileId, position: 2850 })
    reach(world, { fileId, position: 1500 })
    world.service.playbackLeft({ fileId })
    after(world, AUTO_DELETE_DELAY_MS)
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    world.service.noteOpened({ fileId })
    reach(world, { fileId, position: 3000 })
    await ticks(10)
    expect(entries(world)).toHaveLength(1)
    world.service.playbackLeft({ fileId })
    await until(() => entries(world).length === 0)
  })

  it('counts from the switch at the next launch, for a title watched long before it', async () => {
    const before = settingUp({ autoDelete: false, watchedAt: NOW - 24 * 60 * MINUTE })
    await ticks(10)
    before.service.setAutoDelete({ downloadId: ID, autoDelete: true })
    before.service.dispose()
    const world = setup({
      initial: before.store.read(),
      videos: { [VIDEO]: FILE },
      startAt: NOW + 5 * MINUTE,
    })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    expect(world.service.views()[0]?.deletesAt).toBe(NOW + AUTO_DELETE_DELAY_MS)
    expect(entries(world)).toHaveLength(1)
    after(world, 5 * MINUTE)
    await until(() => entries(world).length === 0)
  })

  it('owes the server what it deleted while the server was unreachable, and sends it once back', async () => {
    const owed = { play: true, position: 2800, furthest: 2800, at: NOW - 11 * MINUTE }
    const world = setup({
      initial: holding(entryFor({ autoDelete: true, watchedAt: NOW - 11 * MINUTE, pending: owed })),
      videos: { [VIDEO]: FILE },
      replies: { [PLAY]: { unreachable: 'offline' }, [PROGRESS]: { unreachable: 'offline' } },
    })
    await until(() => entries(world).length === 0)
    expect(world.sent).toContainEqual(DELETED)
    expect(world.store.read().owed).toEqual([{ serverId: SERVER_ID, mediaId: 11, pending: owed }])
    world.table[PLAY] = NO_CONTENT
    world.table[PROGRESS] = NO_CONTENT
    const before = world.log.length
    fireAfter(world, SYNC_RETRY_MS)
    await until(() => world.store.read().owed.length === 0)
    expect(world.log.slice(before)).toEqual([PLAY, PROGRESS])
  })

  describe('while its deletion waits on the server', () => {
    /** Watched eleven minutes ago with a position still owed, its server holding the answer. */
    const waiting = async () => {
      const world = settingUp({
        watchedAt: NOW - 11 * MINUTE,
        pending: { play: false, position: 2800, furthest: 2800, at: NOW - 11 * MINUTE },
      })
      const answer = Promise.withResolvers<void>()
      world.silence.until = answer.promise
      await until(() => delays(world).includes(SYNC_DELETE_WAIT_MS))
      return { world, release: answer.resolve }
    }

    it('keeps a download opened meanwhile, and deletes it once the page leaves', async () => {
      const { world, release } = await waiting()
      const fileId = await play(world)
      release()
      await ticks(10)
      expect(entries(world)).toHaveLength(1)
      expect(world.sent).not.toContainEqual(DELETED)
      world.service.playbackLeft({ fileId })
      await until(() => entries(world).length === 0)
      expect(world.sent).toContainEqual(DELETED)
    })

    it('keeps a download switched off meanwhile', async () => {
      const { world, release } = await waiting()
      world.service.setAutoDelete({ downloadId: ID, autoDelete: false })
      release()
      await ticks(10)
      expect(entries(world)).toHaveLength(1)
      expect(world.sent).not.toContainEqual(DELETED)
    })
  })

  it("deletes a playing download when the viewer asks, whatever its clock's rules", async () => {
    const world = settingUp({})
    await ticks(10)
    await play(world)
    await world.service.remove({ downloadId: ID })
    expect(entries(world)).toEqual([])
    expect(world.sent).not.toContainEqual(DELETED)
  })

  it.each([
    ['remove', (world: World) => world.service.remove({ downloadId: ID })],
    ['removeAll', (world: World) => world.service.removeAll()],
    ['removeServer', (world: World) => world.service.removeServer({ serverId: SERVER_ID })],
  ])('stops the clock of a download deleted through %s', async (_, removing) => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    await removing(world)
    expect(delays(world)).not.toContain(7 * MINUTE)
  })

  it('stops its clocks on dispose', async () => {
    const world = settingUp({ watchedAt: NOW - 3 * MINUTE })
    await until(() => world.service.views()[0]?.deletesAt !== null)
    world.service.dispose()
    expect(delays(world)).not.toContain(7 * MINUTE)
  })
})
