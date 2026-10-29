import {
  AUTH_REFUSALS,
  DOWNLOAD_STATUS_KINDS,
  MEDIA_PROBE_BYTES,
  type MediaTracks,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { CALL_NAMES } from '@/main/servers/allowlist'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  createDownloadQueue,
  DOWNLOAD_CONCURRENCY,
  OUTAGE_RETRY_MS,
  RESUME_SETTLE_MS,
} from '@/main/downloads/downloadQueue'
import { SIDECAR_MAX_BYTES } from '@/main/downloads/sidecarDownload'
import {
  EMPTY_DOWNLOADS,
  entryById,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
  FAIL_REASONS,
  PAUSE_REASONS,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { DOWNLOAD_STALL_MS } from '@/main/downloads/fetchFile'
import {
  createMediaAccess,
  DOWNLOAD_MINTS,
  type AccessOutcome,
  type MediaAccess,
  type ProbeFetch,
  ACCESS_REFUSALS,
} from '@/main/downloads/mediaAccess'
import { SPACE_RESERVE_BYTES } from '@/main/downloads/space'
import { ACCOUNT_TICKET_RENEW_MS, TICKET_OUTCOMES } from '@/main/servers/accountTickets'
import {
  accountTicket,
  cutting,
  fakeAccess,
  fakeDisk,
  fakeNetwork,
  fsError,
  held,
  inTurn,
  mediaOfRequest,
  MINUTE,
  ORIGIN,
  serving,
  subtitleTrack,
  ticks,
  tracksWith,
  until,
  whole,
  type Answer,
} from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const GONE_SERVER_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const USER_DATA = '/data'
const DOWNLOADS = '/data/downloads'
const NOW = 1_700_000_000_000
const GIB = 1024 ** 3
const BLOCK = 4096

const SERVERS: ServerEntry[] = [
  { id: SERVER_ID, origin: 'https://vhagar.example', name: 'Vhagar' },
  { id: OTHER_SERVER_ID, origin: 'https://syrax.example', name: 'Syrax' },
]

/** Every origin answers its ping with the whole body at once. */
const wholePing: ProbeFetch = async () => ({
  ok: true,
  body: new Blob([new Uint8Array(MEDIA_PROBE_BYTES)]).stream(),
})

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
  status: { kind: DOWNLOAD_STATUS_KINDS.queued },
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

const FAR_TICKET = accountTicket('one')

const failedUnreachable = {
  kind: DOWNLOAD_STATUS_KINDS.failed,
  bytes: 0,
  reason: FAIL_REASONS.unreachable,
  message: '',
} as const

const LOCKED: AccessOutcome = {
  ok: false,
  reason: 'locked',
  message: 'Vhagar locked this library again',
}

type SetupProps = {
  entries?: DownloadEntry[]
  free?: number
  access?: MediaAccess['accessFor']
  disk?: Record<string, number>
  tracks?: MediaTracks
  servers?: ServerEntry[]
}

const setup = ({
  entries = [],
  free = 100 * GIB,
  access = async () => FAR_TICKET,
  disk = {},
  tracks = tracksWith([]),
  servers = SERVERS,
}: SetupProps = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries })
  const { timers, pending } = fakeTimers()
  const drive = fakeDisk(disk)
  const network = fakeNetwork()
  const media = fakeAccess(access)
  const table: Record<string, Reply> = Object.fromEntries(
    entries.map(({ mediaId }) => [keyOf({ name: CALL_NAMES.getTracks, mediaId }), ok(tracks)]),
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
    fetch: network.fetch,
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

const fileUrl = (n: number, ticket = 'one'): string =>
  `${ORIGIN}/api/media/${n}/file?t=${ticket}&purpose=download`

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
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
    expect(world.statusOf(2)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
    expect(world.statusOf(3)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.queued })
  })

  it('fetches from the media origin with the ticket, through the origin fetch', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]).toMatchObject({
      url: fileUrl(1),
      headers: {},
    })
    expect(world.drive.dirs.has(dirOf(1))).toBe(true)
  })

  it('starts nothing paused, failed or ready', async () => {
    const world = setup({
      entries: [
        entryFor(1, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(2, {
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 0,
            reason: FAIL_REASONS.other,
            message: 'x',
          },
        }),
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
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.noSpace,
      message: '',
    })
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
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 8192,
            reason: FAIL_REASONS.noSpace,
            message: '',
          },
        }),
      ],
      disk: { [partOf(1)]: 8192 },
    })
    world.network.answers.file = serving({ size: 12_288, sent: 0, isEnding: false })
    world.queue.retry({ downloadId: idOf(1) })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=8192-' })
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 8192 })
  })

  it('stops a file of the group that was still reading its ticket, which stays paused', async () => {
    const ticket = Promise.withResolvers<AccessOutcome>()
    const world = setup({
      free: 10 * GIB,
      entries: [entryFor(2), entryFor(1, { size: 50 * GIB })],
      access: ({ mediaId }) => (mediaId === 2 ? ticket.promise : Promise.resolve(FAR_TICKET)),
    })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
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
    await until(() => (world.statusOf(2)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    await ticks(10)
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([fileUrl(1)])
    expect(world.statusOf(2)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.noSpace,
      message: '',
    })
  })

  it('counts only what the running file still lacks, so a file whose part is nearly whole leaves room', async () => {
    const world = setup({
      free: SPACE_RESERVE_BYTES + 10,
      entries: [
        entryFor(1, {
          group: MOVIE,
          status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 6 },
        }),
        entryFor(2, { group: { ...MOVIE, key: 'movie:91', title: 'Arrival (2016)' } }),
      ],
      disk: { [partOf(1)]: 6 },
    })
    world.network.answers.file = serving({ size: 8, sent: 0, isEnding: false })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 2)
    expect(world.statusOf(2)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
  })

  it('still fails a file with no part that needs more than that', async () => {
    const world = setup({
      free: SPACE_RESERVE_BYTES + 4096,
      entries: [entryFor(1, { size: 12_288 })],
    })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.network.fileRequests()).toEqual([])
  })

  it('fails a file the disk fills under the same way, and keeps its part', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)] })
    world.network.answers.file = serving({ size: 8 })
    world.drive.appendError.value = fsError({ code: 'ENOSPC', syscall: 'write' })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.noSpace,
      message: '',
    })
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
    expect(mediaOfRequest(world.network.fileRequests()[0] ?? { url: '' })).toBe(5)
    expect(world.failed).toEqual([])
  })

  it('reads the ticket again on a 423 and pauses the server on a second', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: inTurn([Promise.resolve(FAR_TICKET), Promise.resolve(accountTicket('two'))]),
    })
    world.network.answers.file = () => refused(423)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused)
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
      { kind: DOWNLOAD_STATUS_KINDS.queued },
      { kind: DOWNLOAD_STATUS_KINDS.queued },
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
      { kind: DOWNLOAD_STATUS_KINDS.queued },
      { kind: 'paused', bytes: 0, reason: 'viewer' },
    ])
  })
})

describe('an outage', () => {
  const unreachableAccess: AccessOutcome = {
    ok: false,
    reason: 'unreachable',
    message: 'Raven could not reach Vhagar.',
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
    expect(world.network.fileRequests().map(mediaOfRequest)).toEqual([1, 5])
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    expect(world.drive.files.has(partOf(1))).toBe(true)
    world.queue.resumeAll()
    expect([1, 2, 3].map(world.statusOf)).toEqual([
      expect.objectContaining({ kind: DOWNLOAD_STATUS_KINDS.failed }),
      { kind: DOWNLOAD_STATUS_KINDS.queued },
      { kind: DOWNLOAD_STATUS_KINDS.queued },
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
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused)
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
    expect(mediaOfRequest(world.network.fileRequests()[0] ?? { url: '' })).toBe(5)
    expect(world.failed).toHaveLength(1)
  })

  it('pauses the rest of the server when its ticket mint cannot reach it', async () => {
    const { calls } = fakeCalls({
      [keyOf({ name: CALL_NAMES.getMediaOrigins })]: ok({
        origins: [{ kind: 'lan', url: ORIGIN }],
      }),
    })
    const media = createMediaAccess({
      calls,
      serverOf: (serverId) => SERVERS.find((server) => server.id === serverId) ?? null,
      probe: wholePing,
      probeClock: () => 0,
      now: () => NOW,
      timers: fakeTimers().timers,
      tickets: { ticketFor: async () => ({ kind: TICKET_OUTCOMES.unreachable }) },
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
    expect(mediaOfRequest(world.network.fileRequests()[0] ?? { url: '' })).toBe(5)
  })

  it('fails the file a 503 answers, forgets the origin and pauses the rest of its server', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3), entryFor(5, { serverId: OTHER_SERVER_ID })],
    })
    world.network.answers.file = (request) =>
      mediaOfRequest(request) === 5 ? serving({ size: 8 })(request) : refused(503)
    world.queue.kick()
    await until(() => (world.statusOf(5)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
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
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.queued })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=4-' })
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 4 })
  })

  it('retries a failed file', async () => {
    const world = setup({
      entries: [
        entryFor(1, {
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 0,
            reason: FAIL_REASONS.other,
            message: 'x',
          },
        }),
      ],
    })
    world.queue.retry({ downloadId: idOf(1) })
    await until(() => world.network.fileRequests().length === 1)
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
  })

  it('keeps the bytes a paused file had written, as many as its part holds', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8, sent: 5, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 5)
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
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
        entryFor(2, {
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 0,
            reason: FAIL_REASONS.other,
            message: 'x',
          },
        }),
      ],
    })
    world.queue.resumeAll()
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.queued })
    expect(world.statusOf(2)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.other,
      message: 'x',
    })
  })
})

describe('an account ticket', () => {
  type AccountFileUrlProps = { n: number; ticket?: string }

  const accountFileUrl = ({ n, ticket = 'account.one' }: AccountFileUrlProps): string =>
    `${ORIGIN}/api/media/${n}/file?t=${ticket}&purpose=download`

  it('fetches the subtitles and the file with one account ticket, through the bare fetch', async () => {
    const world = setup({
      entries: [entryFor(1)],
      access: async () => accountTicket(),
      tracks: tracksWith([subtitleTrack({ id: 'external-0' })]),
    })
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(world.network.requests.map(({ url, headers }) => ({ url, headers }))).toEqual([
      { url: `${ORIGIN}/api/media/1/subtitles/external-0?t=account.one`, headers: {} },
      { url: accountFileUrl({ n: 1 }), headers: {} },
    ])
    expect(world.media.asked).toHaveLength(1)
  })

  it('is never aborted to renew it, however long the file runs', async () => {
    const world = setup({ entries: [entryFor(1)], access: async () => accountTicket() })
    world.network.answers.file = serving({ size: 8, sent: 4, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 4)
    expect([...world.pending.values()].every(({ ms }) => ms <= DOWNLOAD_STALL_MS)).toBe(true)
    world.fireAfter(ACCOUNT_TICKET_RENEW_MS)
    world.fireAfter(5 * MINUTE)
    await ticks(10)
    expect(world.network.fileRequests()).toHaveLength(1)
    expect(world.network.fileRequests()[0]?.signal.aborted ?? null).toBe(false)
    expect(world.media.asked).toHaveLength(1)
  })

  it('reads one more ticket on a 401 and goes on from the bytes on disk', async () => {
    const world = setup({
      entries: [entryFor(1, { status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 4 } })],
      disk: { [partOf(1)]: 4 },
      access: inTurn([
        Promise.resolve(accountTicket('account.one')),
        Promise.resolve(accountTicket('account.two')),
      ]),
    })
    const next = inTurn([() => refused(401), serving({ size: 8 })])
    world.network.answers.file = (request) => next()(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(world.network.fileRequests().map(({ url, headers }) => ({ url, headers }))).toEqual([
      { url: accountFileUrl({ n: 1 }), headers: { Range: 'bytes=4-' } },
      { url: accountFileUrl({ n: 1, ticket: 'account.two' }), headers: { Range: 'bytes=4-' } },
    ])
  })

  it('fails with the account copy and tells the account on a second 401', async () => {
    const world = setup({ entries: [entryFor(1)], access: async () => accountTicket() })
    world.network.answers.file = () => refused(401)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.other,
      message: DOWNLOAD_MESSAGES.signInAgain('Vhagar'),
    })
    expect(world.media.asked).toHaveLength(2)
  })

  it('fails the file and the rest of its group on a 403, tells the account once and goes on', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3), entryFor(4, { group: MOVIE })],
      access: async () => accountTicket(),
    })
    world.network.answers.file = (request) =>
      request.url.includes('/media/1/') ? refused(403) : { status: 200, body: held() }
    world.queue.kick()
    await until(() => (world.statusOf(4)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.downloading)
    const removed = {
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.other,
      message: DOWNLOAD_MESSAGES.removed('Vhagar'),
    } as const
    expect([world.statusOf(1), world.statusOf(2), world.statusOf(3)]).toEqual([
      removed,
      removed,
      removed,
    ])
    expect(world.network.fileRequests()[1]?.signal.aborted ?? null).toBe(true)
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    expect(world.warnings.join('\n')).not.toContain('account.one')
  })

  it('says the account is waiting when a 403 names it pending, not that it was removed', async () => {
    const world = setup({ entries: [entryFor(1)], access: async () => accountTicket() })
    const pending = JSON.stringify({ reason: AUTH_REFUSALS.pending, message: 'Waiting.' })
    world.network.answers.file = () => ({
      status: 403,
      body: whole([new TextEncoder().encode(pending)]),
    })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.other,
      message: DOWNLOAD_MESSAGES.waiting('Vhagar'),
    })
  })

  it('fails the group with the account copy when its ticket is refused, and tells the account', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3)],
      access: async () => ({
        ok: false,
        reason: ACCESS_REFUSALS.account,
        message: DOWNLOAD_MESSAGES.waiting('Vhagar'),
      }),
    })
    world.queue.kick()
    await until(() => (world.statusOf(3)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    await ticks(10)
    expect(world.statusOf(1)).toMatchObject({ message: DOWNLOAD_MESSAGES.waiting('Vhagar') })
    expect(world.statusOf(2)).toMatchObject({ message: DOWNLOAD_MESSAGES.waiting('Vhagar') })
    expect(world.statusOf(3)).toMatchObject({ message: DOWNLOAD_MESSAGES.waiting('Vhagar') })
    expect(world.network.requests).toEqual([])
    expect(world.failed).toHaveLength(1)
  })

  it('mints no more tickets in any five minutes than the budget, and fails no file, over a long queue', async () => {
    const clock = { now: NOW }
    const mintedAt: number[] = []
    const mintTimers = fakeTimers()
    const count = 40
    const media = createMediaAccess({
      calls: fakeCalls({}).calls,
      serverOf: (serverId) => SERVERS.find((server) => server.id === serverId) ?? null,
      probe: wholePing,
      probeClock: () => 0,
      now: () => clock.now,
      timers: mintTimers.timers,
      tickets: {
        ticketFor: async ({ mediaId }) => {
          mintedAt.push(clock.now)
          return { kind: TICKET_OUTCOMES.ticket, ticket: `account.${mediaId}` }
        },
      },
      warn: () => undefined,
    })
    const world = setup({
      entries: Array.from({ length: count }, (_, index) => entryFor(index + 1)),
      access: media.accessFor,
    })
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    /** Lets the queue run until it finishes or waits on the budget, then moves the clock on to the wait's end. */
    const drive = async (rounds: number): Promise<void> => {
      await until(
        () =>
          (world.statusOf(count)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready ||
          mintTimers.pending.size > 0,
        2000,
      )
      if ((world.statusOf(count)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready || rounds === 0)
        return
      await ticks(5)
      const soonest = Math.min(...[...mintTimers.pending.values()].map(({ ms }) => ms))
      clock.now += soonest
      const due = [...mintTimers.pending].filter(([, timer]) => timer.ms === soonest)
      due.forEach(([handle]) => mintTimers.pending.delete(handle))
      due.forEach(([, timer]) => timer.run())
      return drive(rounds - 1)
    }
    await drive(20)
    expect(mintedAt).toHaveLength(count)
    const busiest = Math.max(
      ...mintedAt.map(
        (from) => mintedAt.filter((at) => at >= from && at < from + DOWNLOAD_MINTS.windowMs).length,
      ),
    )
    expect(busiest).toBe(DOWNLOAD_MINTS.budget)
    expect(DOWNLOAD_MINTS).toEqual({ budget: 16, windowMs: 300_000 })
    expect(world.failed).toEqual([])
    expect(
      world.store.read().entries.every(({ status }) => status.kind === DOWNLOAD_STATUS_KINDS.ready),
    ).toBe(true)
  })

  it('fetches the subtitles first, on the fresh ticket, so a video longer than its ticket keeps them', async () => {
    const clock = { now: NOW }
    const ticketMs = 5 * MINUTE
    const world = setup({
      entries: [entryFor(1)],
      access: async () => accountTicket(),
      tracks: tracksWith([subtitleTrack({ id: 'external-0' })]),
    })
    // As the server checks it: a ticket read at the start of the run is refused five minutes on.
    world.network.answers.sidecar = () =>
      clock.now - NOW < ticketMs
        ? { status: 200, body: whole([new TextEncoder().encode('WEBVTT')]) }
        : refused(401)
    const file = serving({ size: 8 })
    world.network.answers.file = (request) => {
      const answer = file(request)
      clock.now += 6 * MINUTE
      return answer
    }
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(world.network.requests.map(({ url }) => url)).toEqual([
      `${ORIGIN}/api/media/1/subtitles/external-0?t=account.one`,
      `${ORIGIN}/api/media/1/file?t=account.one&purpose=download`,
    ])
    expect(world.drive.texts.get(`${dirOf(1)}/subtitles/external-0.vtt`)).toBe('WEBVTT')
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars ?? null).toEqual([
      { trackId: 'external-0', title: 'English', language: 'en' },
    ])
    expect(world.media.asked).toHaveLength(1)
  })
})

describe('a response the server cuts mid-file', () => {
  /** An account ticket per read, numbered per title: `account.<mediaId>.<read>`. */
  const minting = (): MediaAccess['accessFor'] => {
    const reads = new Map<number, number>()
    return async ({ mediaId }) => {
      const read = (reads.get(mediaId) ?? 0) + 1
      reads.set(mediaId, read)
      return accountTicket(`account.${mediaId}.${read}`)
    }
  }
  type MintedUrlProps = { n: number; read: number }

  const mintedUrl = ({ n, read }: MintedUrlProps): string =>
    `${ORIGIN}/api/media/${n}/file?t=account.${n}.${read}&purpose=download`
  type RequestsOfProps = { world: ReturnType<typeof setup>; n: number }

  const requestsOf = ({ world, n }: RequestsOfProps) =>
    world.network
      .fileRequests()
      .filter(({ url }) => url.includes(`/media/${n}/`))
      .map(({ url, headers }) => ({ url, headers }))
  const isOutageArmed = (world: ReturnType<typeof setup>): boolean =>
    [...world.pending.values()].some(({ ms }) => ms === OUTAGE_RETRY_MS)
  type AsksForProps = { world: ReturnType<typeof setup>; n: number }

  const asksFor = ({ world, n }: AsksForProps): number =>
    world.media.asked.filter(({ mediaId }) => mediaId === n).length

  it('resumes an account file from the bytes on disk on one new ticket, failing and pausing nothing', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: minting() })
    const first = inTurn([cutting({ size: 8, sent: 4 }), serving({ size: 8 })])
    world.network.answers.file = (request) =>
      request.url.includes('/media/1/')
        ? first()(request)
        : serving({ size: 8, sent: 2, isEnding: false })(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(requestsOf({ world, n: 1 })).toEqual([
      { url: mintedUrl({ n: 1, read: 1 }), headers: {} },
      { url: mintedUrl({ n: 1, read: 2 }), headers: { Range: 'bytes=4-' } },
    ])
    expect(world.drive.sizeOf(videoOf(1))).toBe(8)
    expect(world.statusOf(2)?.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.downloading)
    expect(requestsOf({ world, n: 2 })).toHaveLength(1)
    expect(world.failed).toEqual([])
    expect(world.media.forgotten).toEqual([])
    expect(isOutageArmed(world)).toBe(false)
  })

  it('resumes an account file whose body ends cleanly short of what it promised, never keeping it as whole', async () => {
    const world = setup({ entries: [entryFor(1)], access: minting() })
    const next = inTurn([serving({ size: 8, sent: 4 }), serving({ size: 8 })])
    world.network.answers.file = (request) => next()(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(requestsOf({ world, n: 1 })).toEqual([
      { url: mintedUrl({ n: 1, read: 1 }), headers: {} },
      { url: mintedUrl({ n: 1, read: 2 }), headers: { Range: 'bytes=4-' } },
    ])
    expect(world.drive.sizeOf(videoOf(1))).toBe(8)
    expect(world.failed).toEqual([])
  })

  it('falls back to the outage when the resumed response is cut again with no new bytes', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: minting() })
    const first = inTurn([cutting({ size: 8, sent: 4 }), cutting({ size: 8, sent: 0 })])
    world.network.answers.file = (request) =>
      request.url.includes('/media/1/')
        ? first()(request)
        : serving({ size: 8, sent: 2, isEnding: false })(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({ ...failedUnreachable, bytes: 4 })
    expect(world.statusOf(2)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.paused,
      bytes: 2,
      reason: PAUSE_REASONS.unreachable,
    })
    expect(requestsOf({ world, n: 1 })).toHaveLength(2)
    expect(asksFor({ world, n: 1 })).toBe(2)
    expect(world.drive.sizeOf(partOf(1))).toBe(4)
    expect(world.media.forgotten).toEqual([SERVER_ID])
    expect(isOutageArmed(world)).toBe(true)
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('falls back to the outage when an account response is cut before any byte', async () => {
    const world = setup({ entries: [entryFor(1)], access: minting() })
    world.network.answers.file = cutting({ size: 8, sent: 0 })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual(failedUnreachable)
    expect(asksFor({ world, n: 1 })).toBe(1)
    expect(isOutageArmed(world)).toBe(true)
  })

  it('still fails with the account copy when the resumed ticket is refused with a 403', async () => {
    const world = setup({ entries: [entryFor(1)], access: minting() })
    const next = inTurn([cutting({ size: 8, sent: 4 }), () => refused(HTTP_STATUSES.forbidden)])
    world.network.answers.file = (request) => next()(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 4,
      reason: FAIL_REASONS.other,
      message: DOWNLOAD_MESSAGES.removed('Vhagar'),
    })
    expect(isOutageArmed(world)).toBe(false)
  })

  it('gives the resumed ticket its own re-read on a 401', async () => {
    const world = setup({ entries: [entryFor(1)], access: minting() })
    const next = inTurn([
      cutting({ size: 8, sent: 4 }),
      () => refused(HTTP_STATUSES.unauthorized),
      serving({ size: 8 }),
    ])
    world.network.answers.file = (request) => next()(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(requestsOf({ world, n: 1 }).map(({ url }) => url)).toEqual([
      mintedUrl({ n: 1, read: 1 }),
      mintedUrl({ n: 1, read: 2 }),
      mintedUrl({ n: 1, read: 3 }),
    ])
  })

  it('keeps the 401 retry it already spent through a cut, so the next 401 fails the file', async () => {
    const world = setup({ entries: [entryFor(1)], access: minting() })
    const next = inTurn([
      () => refused(HTTP_STATUSES.unauthorized),
      cutting({ size: 8, sent: 4 }),
      () => refused(HTTP_STATUSES.unauthorized),
      serving({ size: 8 }),
    ])
    world.network.answers.file = (request) => next()(request)
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 4,
      reason: FAIL_REASONS.other,
      message: DOWNLOAD_MESSAGES.signInAgain('Vhagar'),
    })
    expect(requestsOf({ world, n: 1 })).toHaveLength(3)
    expect(asksFor({ world, n: 1 })).toBe(3)
  })
})

describe('an account whose access ended', () => {
  type ByServerProps = { serverId: string }

  const byServer = async ({ serverId }: ByServerProps) =>
    serverId === SERVER_ID ? accountTicket() : FAR_TICKET

  it("fails the server's running account files, keeping their bytes, and leaves other servers", async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2, { serverId: OTHER_SERVER_ID })],
      access: byServer,
    })
    world.network.answers.file = serving({ size: 8, sent: 4, isEnding: false })
    world.queue.kick()
    await until(
      () =>
        world.drive.sizeOf(partOf(1)) === 4 && world.drive.sizeOf(partOf(2, OTHER_SERVER_ID)) === 4,
    )
    world.queue.accessEnded({ serverId: SERVER_ID })
    await ticks(10)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 4,
      reason: FAIL_REASONS.other,
      message: DOWNLOAD_MESSAGES.signInAgain('Vhagar'),
    })
    const requestOf = (mediaId: number) =>
      world.network.fileRequests().find((request) => mediaOfRequest(request) === mediaId)
    const [mine, theirs] = [requestOf(1), requestOf(2)]
    expect(mine?.signal.aborted ?? null).toBe(true)
    expect(theirs?.signal.aborted ?? null).toBe(false)
    expect(world.statusOf(2)?.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.downloading)
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('does not fetch with a ticket minted while the access ended', async () => {
    const minted = Promise.withResolvers<AccessOutcome>()
    const world = setup({ entries: [entryFor(1)], access: () => minted.promise })
    world.queue.kick()
    await until(() => world.media.asked.length === 1)
    world.queue.accessEnded({ serverId: SERVER_ID })
    minted.resolve(accountTicket())
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toMatchObject({
      message: DOWNLOAD_MESSAGES.signInAgain('Vhagar'),
    })
    expect(world.network.requests).toEqual([])
  })
})

describe('a file whose video is already whole', () => {
  it('finishes without a fetch when a crash came between the rename and the save', async () => {
    const world = setup({
      entries: [entryFor(1, { status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 4 } })],
      disk: { [videoOf(1)]: 8 },
    })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
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
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
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
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars ?? null).toEqual([])
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
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(SIDECAR_MAX_BYTES).toBe(16 * 1024 ** 2)
    expect(world.drive.texts.size).toBe(0)
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars ?? null).toEqual([])
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
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(world.drive.sizeOf(videoOf(1))).toBe(8)
    expect(world.network.sidecarRequests()).toEqual([])
    expect(entryById(world.store.read(), { downloadId: idOf(1) })?.sidecars ?? null).toEqual([])
    expect(world.finished).toHaveLength(1)
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).toContain('Episode 1')
    expect(world.warnings[0]).not.toContain(DOWNLOADS)
  })

  it('finishes with no subtitles when the track list cannot be read', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.table[keyOf({ name: CALL_NAMES.getTracks, mediaId: 1 })] = { unreachable: 'gone' }
    world.network.answers.file = serving({ size: 8 })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
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
      (): Answer => refused(400),
      {
        reason: 'other',
        message: DOWNLOAD_MESSAGES.answered({ serverName: 'Vhagar', status: 400 }),
      } as const,
    ],
  ])('fails as %s with why, keeps going, and is told', async (_name, answer, why) => {
    const world = setup({ entries: [entryFor(1), entryFor(2), entryFor(3)] })
    world.network.answers.file = (request) =>
      request.url.includes('/media/1/') ? answer() : serving({ size: 8 })(request)
    world.queue.kick()
    await until(() => (world.statusOf(3)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 0, ...why })
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('forgets the origin it picked when the server cannot be reached', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = () => {
      throw new Error('net::ERR_CONNECTION_REFUSED')
    }
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
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
    await until(() => (world.statusOf(2)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.gone,
      message: '',
    })
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
  })

  it('fails with the write error, keeps the part and logs the title only', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8 })
    world.drive.appendError.value = fsError({ code: 'EIO', syscall: 'write' })
    world.queue.kick()
    await until(() => (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    expect(world.statusOf(1)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
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
    expect(world.network.fileRequests()[0]?.signal.aborted ?? null).toBe(true)
    expect(world.drive.removed).toEqual([dirOf(1)])
    expect(world.drive.files.has(partOf(1))).toBe(false)
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([idOf(2)])
    expect(world.dropped.map((entries) => entries.map(({ downloadId }) => downloadId))).toEqual([
      [idOf(1)],
    ])
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
      entries: [
        entryFor(1, {
          size: 8192,
          status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 4096 },
        }),
      ],
      disk: { [partOf(1)]: 4096 },
    })
    world.network.answers.file = serving({ size: 8192, sent: 0, isEnding: false })
    world.queue.kick()
    await until(() => world.network.fileRequests().length === 1)
    expect(world.network.fileRequests()[0]?.headers).toEqual({ Range: 'bytes=4096-' })
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 4096 })
  })

  it('holds a kick made while the sweep runs until it is done', async () => {
    const world = setup({ entries: [entryFor(1)] })
    const listing = Promise.withResolvers<void>()
    world.drive.listing.hold = listing.promise
    const sweeping = world.queue.sweep({ wasSetAside: false })
    world.queue.kick()
    await ticks(10)
    expect(world.network.fileRequests()).toEqual([])
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.queued })
    listing.resolve()
    await sweeping
    await until(() => world.network.fileRequests().length === 1)
  })
})

describe('the outage retry', () => {
  const unreachable: AccessOutcome = {
    ok: false,
    reason: 'unreachable',
    message: 'Raven could not reach Vhagar.',
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
    await until(() => (world.statusOf(2)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused)
    expect(OUTAGE_RETRY_MS).toBe(300_000)
    expect(retries(world.pending)).toHaveLength(1)
    reachable.value = true
    world.fireAfter(OUTAGE_RETRY_MS)
    await until(() => world.network.fileRequests().length === 2)
    expect([1, 2].map(world.statusOf)).toEqual([
      { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
      { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
    ])
    expect(retries(world.pending)).toEqual([])
  })

  it('arms one retry however many files wait, and another after a retry that fails', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(2), entryFor(3)],
      access: async () => unreachable,
    })
    world.queue.kick()
    await until(() => (world.statusOf(3)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused)
    await ticks(10)
    expect(retries(world.pending)).toHaveLength(1)
    world.fireAfter(OUTAGE_RETRY_MS)
    await until(
      () =>
        world.media.asked.length === 4 &&
        (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed,
    )
    await ticks(10)
    expect(retries(world.pending)).toHaveLength(1)
  })

  it('tells of the outage once, not again each time a retry finds it still there', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: async () => unreachable })
    world.queue.kick()
    await until(
      () =>
        (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed &&
        (world.statusOf(2)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused,
    )
    expect(world.failed.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    world.fireAfter(OUTAGE_RETRY_MS)
    await until(
      () =>
        world.media.asked.length === 4 &&
        (world.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed,
    )
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
        entryFor(2, {
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 0,
            reason: FAIL_REASONS.unreachable,
            message: '',
          },
        }),
        entryFor(3, { status: { kind: 'paused', bytes: 0, reason: 'viewer' } }),
        entryFor(4, {
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 0,
            reason: FAIL_REASONS.changed,
            message: '',
          },
        }),
      ],
    })
    world.queue.retryOutages()
    await until(() => world.network.fileRequests().length === 2)
    expect(world.network.fileRequests().map(({ url }) => url)).toEqual([fileUrl(1), fileUrl(2)])
    expect(world.statusOf(3)).toEqual({ kind: 'paused', bytes: 0, reason: 'viewer' })
    expect(world.statusOf(4)).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 0,
      reason: FAIL_REASONS.changed,
      message: '',
    })
  })

  it('drops the retry once nothing waits on an outage, and at dispose', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: async () => unreachable })
    world.queue.kick()
    await until(() => (world.statusOf(2)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused)
    await world.queue.remove({ downloadId: idOf(1) })
    expect(retries(world.pending)).toHaveLength(1)
    await world.queue.remove({ downloadId: idOf(2) })
    expect(retries(world.pending)).toEqual([])
    const again = setup({ entries: [entryFor(1)], access: async () => unreachable })
    again.queue.kick()
    await until(() => (again.statusOf(1)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.failed)
    again.queue.dispose()
    expect(retries(again.pending)).toEqual([])
  })

  it('holds what waits on an outage for the viewer on Pause all, so no retry starts it', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(2)], access: async () => unreachable })
    world.queue.kick()
    await until(() => (world.statusOf(2)?.kind ?? null) === DOWNLOAD_STATUS_KINDS.paused)
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
      { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
      { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
      { kind: DOWNLOAD_STATUS_KINDS.queued },
    ])
    expect(world.failed).toEqual([])
  })

  it('keeps the bytes each stopped file had written', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8, sent: 6, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 6)
    world.queue.onSuspend()
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 6 })
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
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
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
      { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
      { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
      { kind: DOWNLOAD_STATUS_KINDS.queued },
    ])
    expect(world.failed).toEqual([])
  })

  it('keeps the bytes each file had written, while it is still downloading', async () => {
    const world = setup({ entries: [entryFor(1)] })
    world.network.answers.file = serving({ size: 8, sent: 7, isEnding: false })
    world.queue.kick()
    await until(() => world.drive.sizeOf(partOf(1)) === 7)
    world.queue.dispose()
    expect(world.statusOf(1)).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 7 })
  })
})
