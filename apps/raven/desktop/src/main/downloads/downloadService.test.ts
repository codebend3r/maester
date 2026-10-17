import { describe, expect, it } from 'bun:test'
import { LOCKED_STATUS, type DownloadTarget, type MediaItem, type Saga } from '@raven/core'
import { EMPTY_CONFIG, type ConfigStore, type DesktopConfig } from '@/main/desktopConfig'
import {
  ASK_TTL_MS,
  createDownloadService,
  DOWNLOAD_MESSAGES,
  DOWNLOADS_EVENT_MS,
} from '@/main/downloads/downloadService'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { DOWNLOADS_DEBOUNCE_MS } from '@/main/downloads/downloadStore'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { SPACE_RESERVE_BYTES } from '@/main/downloads/space'
import { createJsonStore, type StateFs } from '@/main/stateStore'
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

const sequentialIds = (): (() => string) => {
  const counter = { n: 0 }
  return () => {
    counter.n += 1
    return `00000000-0000-4000-8000-${String(counter.n).padStart(12, '0')}`
  }
}

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
  group: { kind: 'season', title: 'Severance', order: 10_001 },
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
}: {
  replies?: Record<string, Reply>
  free?: number
  total?: number
  initial?: DownloadsState
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
  })
  return { service, store, config, table, log, fire, pending, clock, sent, warnings, made }
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
    expect(DOWNLOAD_MESSAGES.relocked('Vhagar')).toBe('Vhagar locked this library again')
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
        group: { kind: 'season', title: 'Severance', order: 10_002 },
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
      { type: 'downloads', downloads: reply.downloads, autoDeleteDefault: false },
    ])
    expect(reply.autoDeleteDefault).toBe(false)
    expect(reply.downloads.map(({ label }) => label)).toEqual([
      'S01E01 Good News',
      'S01E02 Half Loop',
      'S01E03 In Perpetuity',
    ])
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
      group: { kind: 'movie', title: 'Dune (2021)', order: 0 },
      createdAt: NOW - 5000,
      status: { kind: 'paused', bytes: 7, message: null },
      watchedAt: NOW - 100,
    })
    const newer = entryFor({ status: { kind: 'downloading', bytes: GIB }, autoDelete: true })
    const orphan = entryFor({
      downloadId: '00000000-0000-4000-8000-0000000000a2',
      serverId: OTHER_SERVER_ID,
      createdAt: NOW - 9000,
    })
    const world = setup({
      initial: { ...EMPTY_DOWNLOADS, entries: [older, orphan, newer], autoDeleteDefault: true },
    })
    expect(world.service.list()).toEqual({
      type: 'downloads',
      downloads: [
        {
          downloadId: newer.downloadId,
          label: 'S01E01 Good News',
          group: { kind: 'season', title: 'Severance', order: 10_001 },
          serverName: 'Vhagar',
          size: 2 * GIB,
          status: { kind: 'downloading', bytes: GIB },
          autoDelete: true,
          watched: null,
          deletesAt: null,
          needsUnlock: false,
        },
        expect.objectContaining({ downloadId: older.downloadId, watched: null }),
        expect.objectContaining({ downloadId: orphan.downloadId, serverName: '' }),
      ],
      autoDeleteDefault: true,
    })
    expect(world.service.views()).toEqual(downloadsOf(world.service.list()).downloads)
  })

  it('carries no path, origin or media id to the page', () => {
    const world = setup({ initial: { ...EMPTY_DOWNLOADS, entries: [entryFor({})] } })
    const text = JSON.stringify(world.service.list())
    expect(text).not.toContain('vhagar.example')
    expect(text).not.toContain(SERVER_ID)
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
    expect(world.made).toEqual([`${USER_DATA}/downloads`])
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
