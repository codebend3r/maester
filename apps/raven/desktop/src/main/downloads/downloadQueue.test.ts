import { describe, expect, it } from 'bun:test'
import type { MediaTracks } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  createDownloadQueue,
  DOWNLOAD_CONCURRENCY,
  OUTAGE_RETRY_MS,
  RENEWAL_MIN_MS,
  RESUME_SETTLE_MS,
  SIDECAR_MAX_BYTES,
} from '@/main/downloads/downloadQueue'
import {
  EMPTY_DOWNLOADS,
  entryById,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { DOWNLOAD_STALL_MS } from '@/main/downloads/fetchFile'
import { createMediaAccess, type AccessOutcome } from '@/main/downloads/mediaAccess'
import { SPACE_RESERVE_BYTES } from '@/main/downloads/space'
import {
  COOKIE_ACCESS,
  fakeAccess,
  fakeDisk,
  fakeNetwork,
  fsError,
  inTurn,
  MINUTE,
  ORIGIN,
  serving,
  subtitleTrack,
  ticketFor,
  ticks,
  tracksWith,
  until,
  whole,
  type Answer,
} from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const GONE_SERVER_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const USER_DATA = '/data'
const DOWNLOADS = '/data/downloads'
const NOW = 1_700_000_000_000
const GIB = 1024 ** 3
const BLOCK = 4096
const HOUR = 60 * MINUTE

const SERVERS: ServerEntry[] = [
  { id: SERVER_ID, origin: 'https://vhagar.example', name: 'Vhagar', addedAt: 1 },
  { id: OTHER_SERVER_ID, origin: 'https://syrax.example', name: 'Syrax', addedAt: 2 },
]

const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const dirOf = (n: number, serverId = SERVER_ID): string => `${DOWNLOADS}/${serverId}/${n}`
const partOf = (n: number, serverId = SERVER_ID): string => `${dirOf(n, serverId)}/video.mkv.part`
const videoOf = (n: number): string => `${dirOf(n)}/video.mkv`

const SHOW = { kind: 'season', key: 'show:4', title: 'Severance' } as const
const MOVIE = { kind: 'movie', key: 'movie:90', title: 'Dune (2021)', order: 0 } as const

const entryFor = (n: number, overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  downloadId: idOf(n),
  serverId: SERVER_ID,
  mediaId: n,
  label: `Episode ${n}`,
  group: { ...SHOW, order: n },
  container: 'mkv',
  size: 8,
  duration: 3000,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: 'queued' },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: NOW,
  ...overrides,
})

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

const FAR_TICKET = ticketFor({ ticket: 'one', renewAt: NOW + 6 * HOUR })

const failedUnreachable = { kind: 'failed', bytes: 0, reason: 'unreachable', message: '' } as const

const LOCKED: AccessOutcome = {
  ok: false,
  reason: 'locked',
  message: 'Vhagar locked this library again',
}

const setup = ({
  entries = [],
  free = 100 * GIB,
  access = async () => FAR_TICKET,
  disk = {},
  tracks = tracksWith([]),
  servers = SERVERS,
}: {
  entries?: DownloadEntry[]
  free?: number
  access?: (input: { serverId: string; mediaId: number }) => Promise<AccessOutcome>
  disk?: Record<string, number>
  tracks?: MediaTracks
  servers?: ServerEntry[]
} = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries })
  const { timers, pending } = fakeTimers()
  const drive = fakeDisk(disk)
  const network = fakeNetwork()
  const media = fakeAccess(access)
  const table: Record<string, Reply> = Object.fromEntries(
    entries.map(({ mediaId }) => [keyOf({ name: 'getTracks', mediaId }), ok(tracks)]),
  )
  const { calls } = fakeCalls(table)
  const finished: DownloadEntry[] = []
  const failed: DownloadEntry[] = []
  const dropped: (readonly DownloadEntry[])[] = []
  const warnings: string[] = []
  const wakes = { settled: 0 }
  const queue = createDownloadQueue({
    store,
    serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
    servers: () => servers,
    access: media.access,
    fetchFor: network.fetchFor,
    calls,
    fs: drive.fs,
    space: {
      mkdir: async () => undefined,
      statfs: async () => ({ bavail: free / BLOCK, bsize: BLOCK, blocks: (1000 * GIB) / BLOCK }),
    },
    userData: USER_DATA,
    timers,
    now: () => NOW,
    warn: (message) => warnings.push(message),
    onFinished: (entry) => finished.push(entry),
    onFailed: (entry) => failed.push(entry),
    onRemoved: (removed) => dropped.push(removed),
    onAwake: () => {
      wakes.settled += 1
    },
  })
  const statusOf = (n: number) => entryById(store.read(), { downloadId: idOf(n) })?.status ?? null
  /** Runs the timers set for `ms`, and only those. */
  const fireAfter = (ms: number): void => {
    const due = [...pending].filter(([, timer]) => timer.ms === ms)
    due.forEach(([handle]) => pending.delete(handle))
    due.forEach(([, timer]) => timer.run())
  }
  return {
    queue,
    store,
    drive,
    network,
    media,
    table,
    finished,
    failed,
    dropped,
    warnings,
    wakes,
    pending,
    statusOf,
    fireAfter,
  }
}

const fileUrl = (n: number, ticket = 'one'): string => `${ORIGIN}/api/media/${n}/file?t=${ticket}`

const refused = (status: number): Answer => ({ status, body: null })

describe('constants', () => {
  it('downloads two files at once', () => {
    expect(DOWNLOAD_CONCURRENCY).toBe(2)
  })
})

describe('kick', () => {
  it('starts two files at once and keeps the third waiting', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.queue.kick()
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    world.queue.kick()
    await ticks(10)
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([fileUrl(1), fileUrl(2)])
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 0 })
    expect(world.statusOf(2)).toEqual({ kind: 'downloading', bytes: 0 })
    expect(world.statusOf(3)).toEqual({ kind: 'queued' })
  })

  it('fetches from the media origin with the ticket, through the origin fetch', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]).toMatchObject({
      kind: 'origin',
      serverId: SERVER_ID,
      url: fileUrl(1),
      headers: {},
    })
    expect(world.drive.dirs.has(dirOf(1))).toBe(true)
  })

  it('fetches through the session with no ticket when the server lists no origin', async () => {
    const world = setup({ entries: [entryFor(1)], access: async () => COOKIE_ACCESS })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    const [request] = world.network.fileRequests()
    expect(request).toMatchObject({
      kind: 'cookie',
      url: 'https://vhagar.example/api/media/1/file',
    })
    expect(request?.url).not.toContain('t=')
  })

  it('starts nothing paused, failed or ready', async () => {
    const world = setup({
      entries: [
        entryFor(1, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(2, { status: { kind: 'failed', bytes: 0, reason: 'other', message: 'x' } }),
        entryFor(3, { status: { kind: 'ready' } }),
      ],
    })
    world.queue.kick()
    await ticks(10)
    expect(world.network.requests).toEqual([])
  })

  it('takes the next waiting file when one is paused', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    await world.queue.pause({ downloadId: idOf(1) })
    await until(() => world.network.fileRequests().length === 3)
    expect(world.network.fileRequests()[2]?.url).toBe(fileUrl(3))
    expect(world.statusOf(1)).toEqual({ kind: 'paused', bytes: 0, reason: 'viewer' })
  })
})

describe('space', () => {
  it('fails a file that does not fit and pauses the rest of its group, while another group starts', async () => {
    const world = setup({
      free: 10 * GIB,
      entries: [
        entryFor(1, { size: 50 * GIB }),
        entryFor(5, { group: MOVIE, label: 'Dune (2021)' }),
        entryFor(2),
        entryFor(6, { group: { ...MOVIE, key: 'movie:91', title: 'Arrival (2016)' } }),
      ],
    })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(1)).toEqual({ kind: 'failed', bytes: 0, reason: 'noSpace', message: '' })
    expect(world.statusOf(2)).toEqual({ kind: 'paused', bytes: 0, reason: 'noSpace' })
    await until(() => world.network.fileRequests().length === 2)
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([fileUrl(5), fileUrl(6)])
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    expect(world.drive.dirs.has(dirOf(1))).toBe(false)
  })

  it('counts the part on disk, so a retried file needs only what it lacks', async () => {
    const world = setup({
      free: SPACE_RESERVE_BYTES + 4096,
      entries: [
        entryFor(1, {
          size: 12_288,
          status: { kind: 'failed', bytes: 8192, reason: 'noSpace', message: '' },
        }),
      ],
      disk: { [partOf(1)]: 8192 },
    })
    world.network.answers.file = serving({ size: 12_288, sent: 0, isEnding: false })
    world.queue.retry({ downloadId: idOf(1) })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=8192-' })
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 8192 })
  })

  it('stops a file of the group that was still reading its ticket, which stays paused', async () => {
    const ticket = Promise.withResolvers<AccessOutcome>()
    const world = setup({
      free: 10 * GIB,
      entries: [entryFor(2), entryFor(1, { size: 50 * GIB })],
      access: ({ mediaId }) => (mediaId === 2 ? ticket.promise : Promise.resolve(FAR_TICKET)),
    })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(2)).toEqual({ kind: 'paused', bytes: 0, reason: 'noSpace' })
    ticket.resolve(FAR_TICKET)
    await ticks(10)
    expect(world.statusOf(2)).toEqual({ kind: 'paused', bytes: 0, reason: 'noSpace' })
    expect(world.network.fileRequests()).toEqual([])
  })

  it('starts no second file that the first one still needs the room for', async () => {
    const world = setup({
      free: SPACE_RESERVE_BYTES + 12,
      entries: [
        entryFor(1, { group: MOVIE, label: 'Dune (2021)' }),
        entryFor(2, { group: { ...MOVIE, key: 'movie:91', title: 'Arrival (2016)' } }),
      ],
    })
    world.queue.kick()
    await until(() => world.statusOf(2)?.kind === 'failed')
    await ticks(10)
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([fileUrl(1)])
    expect(world.statusOf(2)).toEqual({ kind: 'failed', bytes: 0, reason: 'noSpace', message: '' })
  })

  it('counts only what the running file still lacks, so a file whose part is nearly whole leaves room', async () => {
    const world = setup({
      free: SPACE_RESERVE_BYTES + 10,
      entries: [
        entryFor(1, { group: MOVIE, status: { kind: 'downloading', bytes: 6 } }),
        entryFor(2, { group: { ...MOVIE, key: 'movie:91', title: 'Arrival (2016)' } }),
      ],
      disk: { [partOf(1)]: 6 },
    })
    world.network.answers.file = serving({ size: 8, sent: 0, isEnding: false })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    expect(world.statusOf(2)).toEqual({ kind: 'downloading', bytes: 0 })
  })

  it('still fails a file with no part that needs more than that', async () => {
    const world = setup({
      free: SPACE_RESERVE_BYTES + 4096,
      entries: [entryFor(1, { size: 12_288 })],
    })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.network.fileRequests()).toEqual([])
  })

  it('fails a file the disk fills under the same way, and keeps its part', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)] })
    world.network.answers.file = serving({ size: 8 })
    world.drive.appendError.value = fsError({ code: 'ENOSPC', syscall: 'write' })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(1)).toEqual({ kind: 'failed', bytes: 0, reason: 'noSpace', message: '' })
    expect(world.drive.files.has(partOf(1))).toBe(true)
  })
})

describe('a relock', () => {
  it("pauses the server's files with the relocked message and goes on with another server", async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(5, { serverId: OTHER_SERVER_ID })],
      access: async ({ serverId }) => (serverId === SERVER_ID ? LOCKED : FAR_TICKET),
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    const relocked = { kind: 'paused', bytes: 0, reason: 'relocked' } as const
    expect(world.statusOf(1)).toEqual(relocked)
    expect(world.statusOf(2)).toEqual(relocked)
    expect(world.network.fileRequests()[0]?.serverId).toBe(OTHER_SERVER_ID)
    expect(world.failed).toEqual([])
  })

  it('reads the ticket again on a 423 and pauses the server on a second', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: inTurn([
        Promise.resolve(FAR_TICKET),
        Promise.resolve(ticketFor({ ticket: 'two', renewAt: NOW + 6 * HOUR })),
      ]),
    })
    world.network.answers.file = () => refused(423)
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'paused')
    expect(world.statusOf(1)).toEqual({ kind: 'paused', bytes: 0, reason: 'relocked' })
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([
      fileUrl(1),
      fileUrl(1, 'two'),
    ])
  })
})

describe('resuming after a relock', () => {
  it("requeues every file of that server the relock paused, and no other's", () => {
    const relocked = { kind: 'paused', bytes: 0, reason: 'relocked' } as const
    const world = setup({
      entries: [
        entryFor(1, { status: relocked }),
        entryFor(2, { status: relocked }),
        entryFor(3, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(5, { serverId: OTHER_SERVER_ID, status: relocked }),
      ],
      access: () => new Promise<AccessOutcome>(() => undefined),
    })
    world.queue.resume({ downloadId: idOf(2) })
    expect([1, 2, 3, 5].map(world.statusOf)).toEqual([
      { kind: 'queued' },
      { kind: 'queued' },
      { kind: 'paused', bytes: 0, reason: 'viewer' },
      relocked,
    ])
  })

  it('resumes only the file asked when it was paused for another reason', () => {
    const world = setup({
      entries: [
        entryFor(1, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(2, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
      ],
      access: () => new Promise<AccessOutcome>(() => undefined),
    })
    world.queue.resume({ downloadId: idOf(1) })
    expect([1, 2].map(world.statusOf)).toEqual([
      { kind: 'queued' },
      { kind: 'paused', bytes: 0, reason: 'viewer' },
    ])
  })
})

describe('an outage', () => {
  const unreachableAccess: AccessOutcome = {
    ok: false,
    reason: 'unreachable',
    message: 'raven player could not reach Vhagar.',
  }
  const waiting = { kind: 'paused', bytes: 0, reason: 'unreachable' } as const

  it('fails the file that stalls and pauses the rest of its server, while another server goes on', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3), entryFor(5, { serverId: OTHER_SERVER_ID })],
      access: ({ mediaId }) =>
        mediaId === 2 ? new Promise<AccessOutcome>(() => undefined) : Promise.resolve(FAR_TICKET),
    })
    world.queue.kick()
    await until(
      () =>
        world.media.asked.length === 2 &&
        [...world.pending.values()].some(({ ms }) => ms === DOWNLOAD_STALL_MS),
    )
    world.fireAfter(DOWNLOAD_STALL_MS)
    await until(() => world.network.fileRequests().length === 2)
    expect(world.statusOf(1)).toEqual(failedUnreachable)
    expect(world.statusOf(2)).toEqual(waiting)
    expect(world.statusOf(3)).toEqual(waiting)
    expect(world.network.fileRequests().map(({ serverId }) => serverId)).toEqual([
      SERVER_ID,
      OTHER_SERVER_ID,
    ])
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    expect(world.drive.files.has(partOf(1))).toBe(true)
    world.queue.resumeAll()
    expect([1, 2, 3].map(world.statusOf)).toEqual([
      expect.objectContaining({ kind: 'failed' }),
      { kind: 'queued' },
      { kind: 'queued' },
    ])
  })

  it("keeps the bytes of the server's running files an outage pauses", async () => {
    const second = Promise.withResolvers<AccessOutcome>()
    const world = setup({
      entries: [entryFor(1), entryFor(2)],
      access: ({ mediaId }) => (mediaId === 2 ? second.promise : Promise.resolve(FAR_TICKET)),
    })
    world.network.answers.file = (request) =>
      request.url.includes('/media/1/')
        ? serving({ size: 8, sent: 2, isEnding: false })(request)
        : refused(503)
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 2)
    second.resolve(FAR_TICKET)
    await until(() => world.statusOf(1)?.kind === 'paused')
    expect(world.statusOf(1)).toEqual({ kind: 'paused', bytes: 2, reason: 'unreachable' })
  })

  it('fails the file whose access cannot be read and pauses the rest of its server', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3), entryFor(5, { serverId: OTHER_SERVER_ID })],
      access: async ({ serverId }) => (serverId === SERVER_ID ? unreachableAccess : FAR_TICKET),
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(world.statusOf(1)).toEqual(failedUnreachable)
    expect(world.statusOf(2)).toEqual(waiting)
    expect(world.statusOf(3)).toEqual(waiting)
    expect(world.network.fileRequests()[0]?.serverId).toBe(OTHER_SERVER_ID)
    expect(world.failed).toHaveLength(1)
  })

  it('pauses the rest of the server when its ticket read answers 502', async () => {
    const { calls } = fakeCalls({
      [keyOf({ name: 'getMediaOrigins' })]: ok({ origins: [{ kind: 'lan', url: ORIGIN }] }),
      ...Object.fromEntries(
        [1, 2, 3].map((mediaId) => [
          keyOf({ name: 'getMediaTicket', mediaId }),
          { status: 502, body: '' },
        ]),
      ),
    })
    const media = createMediaAccess({
      calls,
      serverOf: (serverId) => SERVERS.find((server) => server.id === serverId) ?? null,
      probe: async () => ({ status: 200, firstByteMs: 1 }),
      now: () => NOW,
      warn: () => undefined,
    })
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3), entryFor(5, { serverId: OTHER_SERVER_ID })],
      access: (input) =>
        input.serverId === SERVER_ID ? media.accessFor(input) : Promise.resolve(FAR_TICKET),
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(world.statusOf(1)).toEqual(failedUnreachable)
    expect(world.statusOf(2)).toEqual(waiting)
    expect(world.statusOf(3)).toEqual(waiting)
    expect(world.network.fileRequests()[0]?.serverId).toBe(OTHER_SERVER_ID)
  })

  it('fails the file a 503 answers, forgets the origin and pauses the rest of its server', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3), entryFor(5, { serverId: OTHER_SERVER_ID })],
    })
    world.network.answers.file = (request) =>
      request.serverId === SERVER_ID ? refused(503) : serving({ size: 8 })(request)
    world.queue.kick()
    await until(() => world.statusOf(5)?.kind === 'ready')
    expect(world.statusOf(1)).toEqual(failedUnreachable)
    expect(world.statusOf(2)).toEqual(waiting)
    expect(world.statusOf(3)).toEqual(waiting)
    expect(world.media.forgotten).toEqual([SERVER_ID])
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })
})

describe('pause, resume and retry', () => {
  it('resumes a paused file from the bytes on disk', async () => {
    const world = setup({
      entries: [entryFor(1, { status: { kind: 'paused', bytes: 4, reason: 'viewer' } })],
      disk: { [partOf(1)]: 4 },
    })
    world.network.answers.file = serving({ size: 8, sent: 0, isEnding: false })
    world.queue.resume({ downloadId: idOf(1) })
    expect(world.statusOf(1)).toEqual({ kind: 'queued' })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=4-' })
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 4 })
  })

  it('retries a failed file', async () => {
    const world = setup({
      entries: [
        entryFor(1, { status: { kind: 'failed', bytes: 0, reason: 'other', message: 'x' } }),
      ],
    })
    world.queue.retry({ downloadId: idOf(1) })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 0 })
  })

  it('keeps the bytes a paused file had written, as many as its part holds', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8, sent: 5, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 5)
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 0 })
    await world.queue.pause({ downloadId: idOf(1) })
    expect(world.statusOf(1)).toEqual({ kind: 'paused', bytes: 5, reason: 'viewer' })
  })

  it('keeps the bytes of every file Pause all stops', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)] })
    world.network.answers.file = serving({ size: 8, sent: 3, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 3 && world.drive.sizeOf(partOf(2)) === 3)
    await world.queue.pauseAll()
    expect([1, 2].map(world.statusOf)).toEqual([
      { kind: 'paused', bytes: 3, reason: 'viewer' },
      { kind: 'paused', bytes: 3, reason: 'viewer' },
    ])
  })

  it('pauses everything with no message and aborts what runs', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    await world.queue.pauseAll()
    const paused = { kind: 'paused', bytes: 0, reason: 'viewer' } as const
    expect([1, 2, 3].map(world.statusOf)).toEqual([paused, paused, paused])
    expect(world.network.fileRequests().every(({ signal }) => signal.aborted)).toBe(true)
    await ticks(10)
    expect(world.network.fileRequests()).toHaveLength(2)
  })

  it('resumes every paused file and leaves a failed one', () => {
    const world = setup({
      entries: [
        entryFor(1, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(2, { status: { kind: 'failed', bytes: 0, reason: 'other', message: 'x' } }),
      ],
    })
    world.queue.resumeAll()
    expect(world.statusOf(1)).toEqual({ kind: 'queued' })
    expect(world.statusOf(2)).toEqual({ kind: 'failed', bytes: 0, reason: 'other', message: 'x' })
  })
})

describe('the ticket', () => {
  it("renews the server's ticket 5 h 50 m after reading it, and fetches on from the bytes on disk", async () => {
    const ticketKey = keyOf({ name: 'getMediaTicket', mediaId: 1 })
    const table: Record<string, Reply> = {
      [keyOf({ name: 'getMediaOrigins' })]: ok({ origins: [{ kind: 'lan', url: ORIGIN }] }),
      // As the server writes it: epoch milliseconds, six hours on.
      [ticketKey]: ok({ ticket: 'one', expiresAt: NOW + 6 * HOUR }),
    }
    const media = createMediaAccess({
      calls: fakeCalls(table).calls,
      serverOf: (serverId) => SERVERS.find((server) => server.id === serverId) ?? null,
      probe: async () => ({ status: 200, firstByteMs: 1 }),
      now: () => NOW,
      warn: () => undefined,
    })
    const world = setup({ entries: [entryFor(1)], access: media.accessFor })
    world.network.answers.file = serving({ size: 8, sent: 4, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 4)
    const renewMs = 5 * HOUR + 50 * MINUTE
    expect([...world.pending.values()].some(({ ms }) => ms === renewMs)).toBe(true)
    table[ticketKey] = ok({ ticket: 'two', expiresAt: NOW + 12 * HOUR })
    world.fireAfter(renewMs)
    await until(() => world.network.fileRequests().length === 2)
    const [first, second] = world.network.fileRequests()
    expect(first?.signal.aborted).toBe(true)
    expect(second).toMatchObject({ url: fileUrl(1, 'two'), headers: { Range: 'bytes=4-' } })
    expect(world.statusOf(1)?.kind).toBe('downloading')
    expect(world.failed).toEqual([])
  })

  it('renews no sooner than a minute on, however soon the renewal is due', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: async () => ticketFor({ ticket: 'one', renewAt: NOW + 10_000 }),
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(RENEWAL_MIN_MS).toBe(60_000)
    expect(
      [...world.pending.values()].filter(({ ms }) => ms > DOWNLOAD_STALL_MS).map(({ ms }) => ms),
    ).toEqual([RENEWAL_MIN_MS])
  })

  it('never arms a renewal past the longest delay a timer keeps', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: async () => ticketFor({ ticket: 'one', renewAt: NOW * 1000 }),
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(
      [...world.pending.values()].filter(({ ms }) => ms > DOWNLOAD_STALL_MS).map(({ ms }) => ms),
    ).toEqual([2 ** 31 - 1])
  })

  it('is read again once on a 401, and the file goes on', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: inTurn([
        Promise.resolve(FAR_TICKET),
        Promise.resolve(ticketFor({ ticket: 'two', renewAt: NOW + 6 * HOUR })),
      ]),
    })
    const file = serving({ size: 8 })
    const turns = { count: 0 }
    world.network.answers.file = (request) => {
      turns.count += 1
      return turns.count === 1 ? refused(401) : file(request)
    }
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([
      fileUrl(1),
      fileUrl(1, 'two'),
    ])
  })

  it('gives each renewed ticket its own re-read on a 401', async () => {
    const ticket = (name: string, minutes: number) =>
      Promise.resolve(ticketFor({ ticket: name, renewAt: NOW + minutes * MINUTE }))
    const world = setup({
      entries: [entryFor(1)],
      access: inTurn([
        ticket('one', 350),
        ticket('two', 5),
        ticket('three', 350),
        ticket('four', 350),
      ]),
    })
    const next = inTurn([
      () => refused(401),
      serving({ size: 8, sent: 4, isEnding: false }),
      () => refused(401),
      serving({ size: 8 }),
    ])
    world.network.answers.file = (request) => next()(request)
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 4)
    world.fireAfter(5 * MINUTE)
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([
      fileUrl(1, 'one'),
      fileUrl(1, 'two'),
      fileUrl(1, 'three'),
      fileUrl(1, 'four'),
    ])
    expect(world.network.fileRequests()[3]?.headers).toEqual({ Range: 'bytes=4-' })
  })

  it('fails the file on a second 401 with what the server answered', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: inTurn([
        Promise.resolve(FAR_TICKET),
        Promise.resolve(ticketFor({ ticket: 'two', renewAt: NOW + 6 * HOUR })),
      ]),
    })
    world.network.answers.file = () => refused(401)
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(1)).toEqual({
      kind: 'failed',
      bytes: 0,
      reason: 'unauthorized',
      message: '',
    })
    expect(world.media.asked).toHaveLength(2)
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })
})

describe('a file whose video is already whole', () => {
  it('finishes without a fetch when a crash came between the rename and the save', async () => {
    const world = setup({
      entries: [entryFor(1, { status: { kind: 'downloading', bytes: 4 } })],
      disk: { [videoOf(1)]: 8 },
    })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(world.network.requests).toEqual([])
    expect(world.media.asked).toEqual([])
    expect(world.finished.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('fetches again when the video on disk is not the whole file', async () => {
    const world = setup({ entries: [entryFor(1)], disk: { [videoOf(1)]: 3 } })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
  })
})

describe('a finished file', () => {
  it('has its part renamed, its subtitles written and set, and is announced', async () => {
    const world = setup({
      entries: [entryFor(1)],
      tracks: tracksWith([
        subtitleTrack({ id: 'external-0', title: 'English', language: 'en' }),
        subtitleTrack({ id: 'embedded-1', source: 'embedded' }),
        subtitleTrack({ id: 'external-../x' }),
      ]),
    })
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(world.drive.files.has(partOf(1))).toBe(false)
    expect(world.drive.sizeOf(videoOf(1))).toBe(8)
    expect(world.drive.texts.get(`${dirOf(1)}/subtitles/external-0.vtt`)).toBe('WEBVTT')
    expect(world.network.sidecarRequests().map(({ url }) => url)).toEqual([
      `${ORIGIN}/api/media/1/subtitles/external-0?t=one`,
    ])
    const entry = entryById(world.store.read(), { downloadId: idOf(1) })
    expect(entry?.sidecars).toEqual([{ trackId: 'external-0', title: 'English', language: 'en' }])
    expect(world.finished).toEqual([entry!])
  })

  it('skips a subtitle that fails, logging the title and track only', async () => {
    const world = setup({
      entries: [entryFor(1)],
      tracks: tracksWith([subtitleTrack({ id: 'external-0' })]),
    })
    world.network.answers.file = serving({ size: 8 })
    world.network.answers.sidecar = () => refused(404)
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars).toEqual([])
    const log = world.warnings.join('\n')
    expect(log).toContain('Episode 1')
    expect(log).toContain('external-0')
    expect(log).not.toContain('t=one')
    expect(log).not.toContain(DOWNLOADS)
  })

  it('skips a subtitle larger than it keeps, logging the title and track only', async () => {
    const world = setup({
      entries: [entryFor(1)],
      tracks: tracksWith([subtitleTrack({ id: 'external-0' })]),
    })
    world.network.answers.file = serving({ size: 8 })
    world.network.answers.sidecar = () => ({
      status: 200,
      body: whole([new Uint8Array(SIDECAR_MAX_BYTES), new Uint8Array(1)]),
    })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(SIDECAR_MAX_BYTES).toBe(16 * 1024 ** 2)
    expect(world.drive.texts.size).toBe(0)
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars).toEqual([])
    const log = world.warnings.join('\n')
    expect(log).toContain('Episode 1')
    expect(log).toContain('external-0')
    expect(log).not.toContain(DOWNLOADS)
    expect(log).not.toContain('t=one')
  })

  it('finishes with no subtitles when their folder cannot be made', async () => {
    const world = setup({
      entries: [entryFor(1)],
      tracks: tracksWith([subtitleTrack({ id: 'external-0' })]),
    })
    world.drive.unmakeable.add(`${dirOf(1)}/subtitles`)
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(world.drive.sizeOf(videoOf(1))).toBe(8)
    expect(world.network.sidecarRequests()).toEqual([])
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars).toEqual([])
    expect(world.finished).toHaveLength(1)
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).toContain('Episode 1')
    expect(world.warnings[0]).not.toContain(DOWNLOADS)
  })

  it('finishes with no subtitles when the track list cannot be read', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.table[keyOf({ name: 'getTracks', mediaId: 1 })] = { unreachable: 'gone' }
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'ready')
    expect(world.network.sidecarRequests()).toEqual([])
    expect(world.finished).toHaveLength(1)
  })
})

describe('a failed file', () => {
  it.each([
    [
      'changed',
      (): Answer => ({ status: 200, body: null }),
      { reason: 'changed', message: '' } as const,
    ],
    ['gone', (): Answer => refused(404), { reason: 'gone', message: '' } as const],
    [
      'refused',
      (): Answer => refused(403),
      {
        reason: 'other',
        message: DOWNLOAD_MESSAGES.answered({ serverName: 'Vhagar', status: 403 }),
      } as const,
    ],
  ])('fails as %s with why, keeps going, and is told', async (_name, answer, why) => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.network.answers.file = (request) =>
      request.url.includes('/media/1/') ? answer() : serving({ size: 8 })(request)
    world.queue.kick()
    await until(() => world.statusOf(3)?.kind === 'ready')
    expect(world.statusOf(1)).toEqual({ kind: 'failed', bytes: 0, ...why })
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('forgets the origin it picked when the server cannot be reached', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = () => {
      throw new Error('net::ERR_CONNECTION_REFUSED')
    }
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(1)).toEqual(failedUnreachable)
    expect(world.media.forgotten).toEqual([SERVER_ID])
  })

  it('fails the file whose title the ticket read finds gone, and goes on', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2)],
      access: async ({ mediaId }) =>
        mediaId === 1
          ? { ok: false, reason: 'gone', message: EXPAND_MESSAGES.gone('Vhagar') }
          : FAR_TICKET,
    })
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    await until(() => world.statusOf(2)?.kind === 'ready')
    expect(world.statusOf(1)).toEqual({ kind: 'failed', bytes: 0, reason: 'gone', message: '' })
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('fails with why the access could not be read', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: async () => ({ ok: false, reason: 'unreadable', message: 'Vhagar mumbled.' }),
    })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(1)).toEqual({
      kind: 'failed',
      bytes: 0,
      reason: 'other',
      message: 'Vhagar mumbled.',
    })
  })

  it('fails with the write error, keeps the part and logs the title only', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8 })
    world.drive.appendError.value = fsError({ code: 'EIO', syscall: 'write' })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed')
    expect(world.statusOf(1)).toEqual({
      kind: 'failed',
      bytes: 0,
      reason: 'other',
      message: 'write EIO',
    })
    expect(world.drive.files.has(partOf(1))).toBe(true)
    const log = world.warnings.join('\n')
    expect(log).toContain('Episode 1')
    expect(log).not.toContain(DOWNLOADS)
  })
})

describe('remove', () => {
  it('aborts a downloading file, removes its folder and drops it', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    await world.queue.remove({ downloadId: idOf(1) })
    expect(world.network.fileRequests()[0]?.signal.aborted).toBe(true)
    expect(world.drive.removed).toEqual([dirOf(1)])
    expect(world.drive.files.has(partOf(1))).toBe(false)
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([idOf(2)])
    expect(world.dropped.map((entries) => entries.map(({ downloadId }) => downloadId))).toEqual([
      [idOf(1)],
    ])
  })

  it("aborts a server's files, removes its folder, drops them and forgets its origin", async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(5, { serverId: OTHER_SERVER_ID })],
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    await world.queue.removeServer({ serverId: SERVER_ID })
    expect(world.network.fileRequests().every(({ signal }) => signal.aborted)).toBe(true)
    expect(world.drive.removed).toEqual([`${DOWNLOADS}/${SERVER_ID}`])
    expect(world.media.forgotten).toEqual([SERVER_ID])
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([idOf(5)])
    expect(world.dropped.map((entries) => entries.map(({ downloadId }) => downloadId))).toEqual([
      [idOf(1), idOf(2)],
    ])
    await until(() => world.network.fileRequests().length === 3)
    expect(world.network.fileRequests()[2]?.serverId).toBe(OTHER_SERVER_ID)
  })

  it('removes nothing for a server id that is not one', async () => {
    const world = setup({ entries: [entryFor(1)] })
    await world.queue.removeServer({ serverId: '..' })
    expect(world.drive.removed).toEqual([])
    expect(world.store.read().entries).toHaveLength(1)
    expect(world.dropped).toEqual([])
  })

  it('removes every download and the whole downloads folder', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3)],
      disk: { [`${DOWNLOADS}/${GONE_SERVER_ID}/7/video.mkv`]: 8 },
    })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    await world.queue.removeAll()
    expect(world.network.fileRequests().every(({ signal }) => signal.aborted)).toBe(true)
    expect(world.drive.removed).toEqual([DOWNLOADS])
    expect(world.drive.files.size).toBe(0)
    expect(world.store.read().entries).toEqual([])
    expect(world.dropped.map((entries) => entries.map(({ downloadId }) => downloadId))).toEqual([
      [idOf(1), idOf(2), idOf(3)],
    ])
    await ticks(10)
    expect(world.network.fileRequests()).toHaveLength(2)
  })
})

describe('a relaunch', () => {
  it('resumes a file left downloading from the bytes on disk', async () => {
    const world = setup({
      entries: [entryFor(1, { size: 8192, status: { kind: 'downloading', bytes: 4096 } })],
      disk: { [partOf(1)]: 4096 },
    })
    world.network.answers.file = serving({ size: 8192, sent: 0, isEnding: false })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=4096-' })
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 4096 })
  })

  it('holds a kick made while the sweep runs until it is done', async () => {
    const world = setup({ entries: [entryFor(1)] })
    const listing = Promise.withResolvers<void>()
    world.drive.listing.hold = listing.promise
    const sweeping = world.queue.sweep({ wasSetAside: false })
    world.queue.kick()
    await ticks(10)
    expect(world.network.fileRequests()).toEqual([])
    expect(world.statusOf(1)).toEqual({ kind: 'queued' })
    listing.resolve()
    await sweeping
    await until(() => world.network.fileRequests().length === 1)
  })
})

describe('the outage retry', () => {
  const unreachable: AccessOutcome = {
    ok: false,
    reason: 'unreachable',
    message: 'raven player could not reach Vhagar.',
  }
  const retries = (pending: ReturnType<typeof setup>['pending']) =>
    [...pending.values()].filter(({ ms }) => ms === OUTAGE_RETRY_MS)

  it('tries a server again every five minutes while its files wait on an outage', async () => {
    const reachable = { value: false }
    const world = setup({
      entries: [entryFor(1), entryFor(2)],
      access: async () => (reachable.value ? FAR_TICKET : unreachable),
    })
    world.queue.kick()
    await until(() => world.statusOf(2)?.kind === 'paused')
    expect(OUTAGE_RETRY_MS).toBe(300_000)
    expect(retries(world.pending)).toHaveLength(1)
    reachable.value = true
    world.fireAfter(OUTAGE_RETRY_MS)
    await until(() => world.network.fileRequests().length === 2)
    expect([1, 2].map(world.statusOf)).toEqual([
      { kind: 'downloading', bytes: 0 },
      { kind: 'downloading', bytes: 0 },
    ])
    expect(retries(world.pending)).toEqual([])
  })

  it('arms one retry however many files wait, and another after a retry that fails', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3)],
      access: async () => unreachable,
    })
    world.queue.kick()
    await until(() => world.statusOf(3)?.kind === 'paused')
    await ticks(10)
    expect(retries(world.pending)).toHaveLength(1)
    world.fireAfter(OUTAGE_RETRY_MS)
    await until(() => world.media.asked.length === 4 && world.statusOf(1)?.kind === 'failed')
    await ticks(10)
    expect(retries(world.pending)).toHaveLength(1)
  })

  it('tells of the outage once, not again each time a retry finds it still there', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: async () => unreachable })
    world.queue.kick()
    await until(() => world.statusOf(1)?.kind === 'failed' && world.statusOf(2)?.kind === 'paused')
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    world.fireAfter(OUTAGE_RETRY_MS)
    await until(() => world.media.asked.length === 4 && world.statusOf(1)?.kind === 'failed')
    await ticks(10)
    expect(world.failed).toHaveLength(1)
    world.queue.retry({ downloadId: idOf(1) })
    await until(() => world.media.asked.length === 5)
    await until(() => world.failed.length === 2)
  })

  it('requeues at launch what waits on an outage, and nothing the viewer paused', async () => {
    const world = setup({
      entries: [
        entryFor(1, { status: { kind: 'paused', bytes: 0, reason: 'unreachable' } }),
        entryFor(2, { status: { kind: 'failed', bytes: 0, reason: 'unreachable', message: '' } }),
        entryFor(3, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(4, { status: { kind: 'failed', bytes: 0, reason: 'changed', message: '' } }),
      ],
    })
    world.queue.retryOutages()
    await until(() => world.network.fileRequests().length === 2)
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([fileUrl(1), fileUrl(2)])
    expect(world.statusOf(3)).toEqual({ kind: 'paused', bytes: 0, reason: 'viewer' })
    expect(world.statusOf(4)).toEqual({ kind: 'failed', bytes: 0, reason: 'changed', message: '' })
  })

  it('drops the retry once nothing waits on an outage, and at dispose', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: async () => unreachable })
    world.queue.kick()
    await until(() => world.statusOf(2)?.kind === 'paused')
    await world.queue.remove({ downloadId: idOf(1) })
    expect(retries(world.pending)).toHaveLength(1)
    await world.queue.remove({ downloadId: idOf(2) })
    expect(retries(world.pending)).toEqual([])
    const again = setup({ entries: [entryFor(1)], access: async () => unreachable })
    again.queue.kick()
    await until(() => again.statusOf(1)?.kind === 'failed')
    again.queue.dispose()
    expect(retries(again.pending)).toEqual([])
  })

  it('holds what waits on an outage for the viewer on Pause all, so no retry starts it', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: async () => unreachable })
    world.queue.kick()
    await until(() => world.statusOf(2)?.kind === 'paused')
    await world.queue.pauseAll()
    expect([1, 2].map(world.statusOf)).toEqual([
      { kind: 'paused', bytes: 0, reason: 'viewer' },
      { kind: 'paused', bytes: 0, reason: 'viewer' },
    ])
    expect(retries(world.pending)).toEqual([])
  })
})

describe('a sleep', () => {
  it('stops every fetch, leaves its files downloading with no failure, and starts none', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    world.queue.onSuspend()
    expect(world.network.fileRequests().every(({ signal }) => signal.aborted)).toBe(true)
    await ticks(10)
    world.queue.kick()
    await ticks(10)
    expect(world.network.fileRequests()).toHaveLength(2)
    expect([1, 2, 3].map(world.statusOf)).toEqual([
      { kind: 'downloading', bytes: 0 },
      { kind: 'downloading', bytes: 0 },
      { kind: 'queued' },
    ])
    expect(world.failed).toEqual([])
  })

  it('keeps the bytes each stopped file had written', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8, sent: 6, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 6)
    world.queue.onSuspend()
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 6 })
  })

  it('starts them again from the bytes on disk once the wake has settled', async () => {
    const world = setup({ entries: [entryFor(1, { size: 8 })] })
    world.network.answers.file = serving({ size: 8, sent: 4, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 4)
    world.queue.onSuspend()
    await ticks(10)
    world.queue.onResume()
    await ticks(10)
    expect(world.network.fileRequests()).toHaveLength(1)
    expect(RESUME_SETTLE_MS).toBe(5000)
    world.fireAfter(RESUME_SETTLE_MS)
    await until(() => world.network.fileRequests().length === 2)
    expect(world.network.fileRequests()[1]?.headers).toEqual({ Range: 'bytes=4-' })
    expect(world.media.forgotten).toContain(SERVER_ID)
  })

  it('says the wake has settled once, after the settle and not before', () => {
    const world = setup()
    world.queue.onSuspend()
    world.queue.onResume()
    world.queue.onResume()
    expect(world.wakes.settled).toBe(0)
    world.fireAfter(RESUME_SETTLE_MS)
    expect(world.wakes.settled).toBe(1)
  })

  it('requeues on the wake what waits on an outage', async () => {
    const world = setup({
      entries: [entryFor(1, { status: { kind: 'paused', bytes: 0, reason: 'unreachable' } })],
    })
    world.queue.onSuspend()
    world.queue.onResume()
    world.fireAfter(RESUME_SETTLE_MS)
    await until(() => world.network.fileRequests().length === 1)
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 0 })
  })
})

describe('dispose', () => {
  it('aborts every fetch, leaves the entries as they are and starts nothing more', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    world.queue.dispose()
    expect(world.network.fileRequests().every(({ signal }) => signal.aborted)).toBe(true)
    await ticks(10)
    world.queue.kick()
    await ticks(10)
    expect(world.network.fileRequests()).toHaveLength(2)
    expect([1, 2, 3].map(world.statusOf)).toEqual([
      { kind: 'downloading', bytes: 0 },
      { kind: 'downloading', bytes: 0 },
      { kind: 'queued' },
    ])
    expect(world.failed).toEqual([])
  })

  it('keeps the bytes each file had written, while it is still downloading', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8, sent: 7, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 7)
    world.queue.dispose()
    expect(world.statusOf(1)).toEqual({ kind: 'downloading', bytes: 7 })
  })
})
