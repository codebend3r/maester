import { describe, expect, it } from 'bun:test'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  notePending,
  remove,
  type DownloadEntry,
  type DownloadsState,
  type Owed,
} from '@/main/downloads/downloadState'
import { createSync, settleWithin, SYNC_DEBOUNCE_MS, SYNC_RETRY_MS } from '@/main/downloads/sync'
import type { AllowedCall } from '@/main/servers/allowlist'
import type { ServerCallResult } from '@/main/servers/serverCalls'
import type { JsonStore } from '@/main/stateStore'
import { ticks } from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
const THIRD_ID = '00000000-0000-4000-8000-0000000000a2'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const UNREACHABLE: ServerCallResult = { ok: false, message: 'unreachable' }
const NOW = 1_700_000_000_000
const GIB = 1024 ** 3
const NO_CONTENT: ServerCallResult = { ok: true, status: 204, body: '' }

const entryFor = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
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

const memoryStore = (initial: DownloadsState): JsonStore<DownloadsState> => {
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

/** A promise settled from outside, so a test can hold a call and answer it later. */
const gate = () => {
  const held: { open: (result: ServerCallResult) => void } = { open: () => undefined }
  const answer = new Promise<ServerCallResult>((resolve) => {
    held.open = resolve
  })
  return { answer, open: held.open }
}

const setup = ({
  entries = [entryFor()],
  owed = [],
  retryMs = SYNC_RETRY_MS,
}: { entries?: DownloadEntry[]; owed?: Owed[]; retryMs?: number } = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries, owed })
  const { timers, pending } = fakeTimers()
  const log: AllowedCall[] = []
  const server: { answer: (call: AllowedCall) => Promise<ServerCallResult> } = {
    answer: async () => NO_CONTENT,
  }
  const warnings: string[] = []
  const sync = createSync({
    store,
    calls: {
      call: async ({ call }) => {
        log.push(call)
        return server.answer(call)
      },
    },
    timers,
    warn: (message) => warnings.push(message),
    retryMs,
  })
  /** Records a play and a position for a download, as playback does, then touches it. */
  const note = ({
    downloadId = ID,
    play = false,
    position,
  }: {
    downloadId?: string
    play?: boolean
    position: number
  }): void => {
    store.update((state) => notePending(state, { downloadId, play, position, at: NOW }))
    sync.touch({ downloadId })
  }
  /** Runs the timers set for this long, as the clock would. */
  const fireAt = (ms: number): void => {
    const due = [...pending].filter(([, timer]) => timer.ms === ms)
    due.forEach(([handle, timer]) => {
      pending.delete(handle)
      timer.run()
    })
  }
  const pendingOf = (downloadId = ID) =>
    store.read().entries.find((entry) => entry.downloadId === downloadId)?.pending
  return { sync, store, pending, log, server, warnings, note, fireAt, pendingOf }
}

describe('constants', () => {
  it("are the spec's", () => {
    expect(SYNC_DEBOUNCE_MS).toBe(2000)
    expect(SYNC_RETRY_MS).toBe(300_000)
  })
})

describe('touch', () => {
  it('sends nothing until the debounce has run, then the play and the position in that order', async () => {
    const world = setup()
    world.note({ play: true, position: 300 })
    await ticks(3)
    expect(world.log).toEqual([])
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 300 },
    ])
  })

  it('sends once with the newer position when it is touched again within the debounce', async () => {
    const world = setup()
    world.note({ play: true, position: 300 })
    world.note({ position: 450 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 450 },
    ])
    expect(world.pending.size).toBe(1)
  })

  it('sends no play for a position alone', async () => {
    const world = setup()
    world.note({ position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
  })

  it('clears both the play and the position once the server answers 2xx', async () => {
    const world = setup()
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
    expect(world.pending.size).toBe(1)
    world.fireAt(SYNC_RETRY_MS)
    await ticks(3)
    expect(world.pending.size).toBe(0)
    expect(world.log).toHaveLength(2)
  })

  it('keeps a position saved between the send and the answer, and sends it after a debounce', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = (call) =>
      call.name === 'saveProgress' ? held.answer : Promise.resolve(NO_CONTENT)
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    world.note({ position: 360 })
    held.open(NO_CONTENT)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: false, position: 360, furthest: 360, at: NOW })
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log.slice(2)).toEqual([{ name: 'saveProgress', mediaId: 11, position: 360 }])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('sends a play flagged while the position is out on the next round', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = () => held.answer
    world.note({ position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(3)
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
    world.note({ play: true, position: 360 })
    held.open(NO_CONTENT)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: true, position: 360, furthest: 360, at: NOW })
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log.slice(1)).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 360 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('starts no second send for a download whose calls are still out', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = () => held.answer
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(3)
    world.note({ position: 360 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(3)
    expect(world.log).toEqual([{ name: 'recordPlay', mediaId: 11 }])
    held.open(UNREACHABLE)
    await ticks(5)
    expect(world.log).toHaveLength(1)
    // The position saved meanwhile owes a send of its own, which waits for the retry now that
    // the server could not be reached.
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toHaveLength(1)
    world.fireAt(SYNC_RETRY_MS)
    await ticks(8)
    expect(world.log.slice(1)).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 360 },
    ])
  })

  it('sends no position when the play did not get through', async () => {
    const world = setup()
    world.server.answer = async (call) =>
      call.name === 'recordPlay' ? { ok: false, message: 'unreachable' } : NO_CONTENT
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toEqual([{ name: 'recordPlay', mediaId: 11 }])
    expect(world.pendingOf()).toEqual({ play: true, position: 300, furthest: 300, at: NOW })
  })

  it('keeps the play when only the position fails, and does not send the play again', async () => {
    const world = setup()
    world.server.answer = async (call) =>
      call.name === 'saveProgress' ? { ok: false, message: 'unreachable' } : NO_CONTENT
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: false, position: 300, furthest: 300, at: NOW })
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(5)
    expect(world.log.slice(2)).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
  })
})

describe('a scrub back', () => {
  it('sends the play, then the furthest position, then the last, and clears them all', async () => {
    const world = setup()
    world.note({ play: true, position: 2850 })
    world.note({ position: 2100 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(8)
    expect(world.log).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 2850 },
      { name: 'saveProgress', mediaId: 11, position: 2100 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('sends no furthest call when the last position is the furthest', async () => {
    const world = setup()
    world.note({ position: 2100 })
    world.note({ position: 2850 })
    await world.sync.runAll()
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 2850 }])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('keeps a furthest raised during the call, and sends it before the last on the next round', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = (call) =>
      call.name === 'saveProgress' && call.position === 2100
        ? held.answer
        : Promise.resolve(NO_CONTENT)
    world.note({ position: 2850 })
    world.note({ position: 2100 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(8)
    world.note({ position: 2950 })
    world.note({ position: 2200 })
    held.open(NO_CONTENT)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: false, position: 2200, furthest: 2950, at: NOW })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(8)
    expect(world.log.slice(2)).toEqual([
      { name: 'saveProgress', mediaId: 11, position: 2950 },
      { name: 'saveProgress', mediaId: 11, position: 2200 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('stops the round when the furthest call fails, and keeps both positions', async () => {
    const world = setup()
    world.server.answer = async (call) =>
      call.name === 'saveProgress' ? { ok: false, message: 'unreachable' } : NO_CONTENT
    world.note({ play: true, position: 2850 })
    world.note({ position: 2100 })
    await world.sync.runAll()
    expect(world.log).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 2850 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: 2100, furthest: 2850, at: NOW })
  })
})

describe('an answer that is no success', () => {
  it('keeps pending when the server is unreachable, and the retry timer sends it again', async () => {
    const world = setup()
    world.server.answer = async () => ({ ok: false, message: 'unreachable' })
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: true, position: 300, furthest: 300, at: NOW })
    expect(world.warnings).toEqual([])
    expect([...world.pending.values()].map(({ ms }) => ms)).toEqual([SYNC_RETRY_MS])
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(5)
    expect(world.log.slice(1)).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 300 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('tries again after the retry it was given in place of the five minutes', async () => {
    const world = setup({ retryMs: 7000 })
    world.server.answer = async () => UNREACHABLE
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect([...world.pending.values()].map(({ ms }) => ms)).toEqual([7000])
    world.server.answer = async () => NO_CONTENT
    world.fireAt(7000)
    await ticks(5)
    expect(world.log.slice(1)).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 300 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('arms the retry again while something is still pending after a retry', async () => {
    const world = setup()
    world.server.answer = async () => ({ ok: false, message: 'unreachable' })
    world.note({ position: 300 })
    world.fireAt(SYNC_RETRY_MS)
    await ticks(5)
    expect([...world.pending.values()].map(({ ms }) => ms)).toContain(SYNC_RETRY_MS)
  })

  it('keeps pending on a 404, logs it once by title, and sends again only on the next runAll', async () => {
    const world = setup()
    world.server.answer = async () => ({ ok: true, status: 404, body: '' })
    world.note({ position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: false, position: 300, furthest: 300, at: NOW })
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).toContain('S01E01 Good News')
    expect(world.warnings[0]).toContain('404')
    expect(world.warnings[0]).not.toContain('/api')
    await ticks(5)
    expect(world.log).toHaveLength(1)
    await world.sync.runAll()
    expect(world.log).toHaveLength(2)
    expect(world.warnings).toHaveLength(1)
  })

  it('logs a 403 once, and logs again after a success cleared the title', async () => {
    const world = setup()
    world.server.answer = async () => ({ ok: true, status: 403, body: '' })
    world.note({ position: 300 })
    await world.sync.runAll()
    await world.sync.runAll()
    expect(world.warnings).toHaveLength(1)
    world.server.answer = async () => NO_CONTENT
    await world.sync.runAll()
    world.note({ position: 400 })
    world.server.answer = async () => ({ ok: true, status: 403, body: '' })
    await world.sync.runAll()
    expect(world.warnings).toHaveLength(2)
  })

  it('forgets a logged download once it is gone, so a new one of the same id is logged', async () => {
    const world = setup()
    world.server.answer = async () => ({ ok: true, status: 404, body: '' })
    world.note({ position: 300 })
    await world.sync.runAll()
    expect(world.warnings).toHaveLength(1)
    world.store.update((state) => ({ ...state, entries: [] }))
    await world.sync.runAll()
    world.store.update((state) => ({ ...state, entries: [entryFor()] }))
    world.note({ position: 300 })
    await world.sync.runAll()
    expect(world.warnings).toHaveLength(2)
  })

  it.each([401, 423, 500])('keeps pending on a %i without a word', async (status) => {
    const world = setup()
    world.server.answer = async () => ({ ok: true, status, body: '' })
    world.note({ play: true, position: 300 })
    await world.sync.runAll()
    expect(world.pendingOf()).toEqual({ play: true, position: 300, furthest: 300, at: NOW })
    expect(world.warnings).toEqual([])
  })

  it('warns, without the error text of a path, when a call throws', async () => {
    const world = setup()
    world.server.answer = async () => {
      throw new Error('boom')
    }
    world.note({ position: 300 })
    await world.sync.runAll()
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).toContain('S01E01 Good News')
    expect(world.pendingOf()).toEqual({ play: false, position: 300, furthest: 300, at: NOW })
  })
})

describe('after an unreachable answer', () => {
  it("holds the server's touches for the retry, until a success lets them send again", async () => {
    const world = setup()
    world.server.answer = async () => UNREACHABLE
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toHaveLength(1)
    world.note({ position: 310 })
    world.note({ position: 320 })
    expect([...world.pending.values()].map(({ ms }) => ms)).toEqual([SYNC_RETRY_MS])
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(8)
    expect(world.log.slice(1)).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 320 },
    ])
    world.note({ position: 330 })
    expect([...world.pending.values()].map(({ ms }) => ms)).toContain(SYNC_DEBOUNCE_MS)
  })

  it("holds every download of that server, and none of another server's", async () => {
    const other = entryFor({ downloadId: OTHER_ID, mediaId: 12 })
    const elsewhere = entryFor({ downloadId: THIRD_ID, serverId: OTHER_SERVER_ID, mediaId: 13 })
    const world = setup({ entries: [entryFor(), other, elsewhere] })
    world.server.answer = async () => UNREACHABLE
    world.note({ position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    world.server.answer = async () => NO_CONTENT
    world.note({ downloadId: OTHER_ID, position: 40 })
    world.note({ downloadId: THIRD_ID, position: 50 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log.slice(1)).toEqual([{ name: 'saveProgress', mediaId: 13, position: 50 }])
  })
})

describe('the launch and retry runs', () => {
  const pendingAt = ({ at, position }: { at: number; position: number }) => ({
    play: false,
    position,
    furthest: position,
    at,
  })

  it('send one download at a time per server, oldest first, with servers side by side', async () => {
    const newer = entryFor({ pending: pendingAt({ at: NOW + 2, position: 300 }) })
    const older = entryFor({
      downloadId: OTHER_ID,
      mediaId: 12,
      pending: pendingAt({ at: NOW + 1, position: 40 }),
    })
    const elsewhere = entryFor({
      downloadId: THIRD_ID,
      serverId: OTHER_SERVER_ID,
      mediaId: 13,
      pending: pendingAt({ at: NOW + 3, position: 50 }),
    })
    const world = setup({ entries: [newer, older, elsewhere] })
    const held = gate()
    world.server.answer = (call) =>
      call.name === 'saveProgress' && call.mediaId === 12
        ? held.answer
        : Promise.resolve(NO_CONTENT)
    const running = world.sync.runAll()
    await ticks(5)
    expect(world.log).toEqual([
      { name: 'saveProgress', mediaId: 12, position: 40 },
      { name: 'saveProgress', mediaId: 13, position: 50 },
    ])
    held.open(NO_CONTENT)
    await running
    expect(world.log.slice(2)).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
  })

  it("end a server's round at its first unreachable answer, and the retry sends the rest in order", async () => {
    const newer = entryFor({ pending: pendingAt({ at: NOW + 2, position: 300 }) })
    const older = entryFor({
      downloadId: OTHER_ID,
      mediaId: 12,
      pending: pendingAt({ at: NOW + 1, position: 40 }),
    })
    const world = setup({ entries: [newer, older] })
    world.server.answer = async () => UNREACHABLE
    await world.sync.runAll()
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 12, position: 40 }])
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(10)
    expect(world.log.slice(1)).toEqual([
      { name: 'saveProgress', mediaId: 12, position: 40 },
      { name: 'saveProgress', mediaId: 11, position: 300 },
    ])
  })
})

describe('runAll', () => {
  it('sends at once what every download has pending, and nothing for one with nothing pending', async () => {
    const other = entryFor({ downloadId: OTHER_ID, mediaId: 12 })
    const world = setup({ entries: [entryFor(), other] })
    world.note({ position: 300 })
    await world.sync.runAll()
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
    expect(world.pendingOf()).toEqual({ play: false, position: null, furthest: null, at: NOW })
  })

  it('settles only after the answers are in', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = () => held.answer
    world.note({ position: 300 })
    const settled = { value: false }
    const running = (async () => {
      await world.sync.runAll()
      settled.value = true
    })()
    await ticks(5)
    expect(settled.value).toBe(false)
    held.open(NO_CONTENT)
    await running
    expect(settled.value).toBe(true)
    expect(world.pendingOf()?.position).toBeNull()
  })

  it('sends a download that is out once, however many times it is run', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = () => held.answer
    world.note({ position: 300 })
    const first = world.sync.runAll()
    const second = world.sync.runAll()
    await ticks(3)
    held.open(NO_CONTENT)
    await Promise.all([first, second])
    expect(world.log).toHaveLength(1)
  })

  it('runFor sends only the downloads it names', async () => {
    const other = entryFor({ downloadId: OTHER_ID, mediaId: 12 })
    const world = setup({ entries: [entryFor(), other] })
    world.note({ position: 300 })
    world.note({ downloadId: OTHER_ID, position: 40 })
    await world.sync.runFor({ downloadIds: [OTHER_ID] })
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 12, position: 40 }])
  })

  it('sends nothing for a download deleted before its debounce ran', async () => {
    const world = setup()
    world.note({ position: 300 })
    world.store.update((state) => ({ ...state, entries: [] }))
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toEqual([])
  })
})

describe('what removed downloads owe', () => {
  const OWED_PENDING = { play: true, position: 300, furthest: 2900, at: NOW }
  const owedFor = (overrides: Partial<Owed> = {}): Owed => ({
    serverId: SERVER_ID,
    mediaId: 11,
    pending: OWED_PENDING,
    ...overrides,
  })

  it('sends the play, the furthest and the last position of an owed item, then drops it', async () => {
    const world = setup({ entries: [], owed: [owedFor()] })
    await world.sync.runAll()
    expect(world.log).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 2900 },
      { name: 'saveProgress', mediaId: 11, position: 300 },
    ])
    expect(world.store.read().owed).toEqual([])
  })

  it('keeps an owed item while its server is unreachable, and the retry sends it', async () => {
    const world = setup({ entries: [], owed: [owedFor()] })
    world.server.answer = async () => UNREACHABLE
    await world.sync.runAll()
    expect(world.store.read().owed).toEqual([owedFor()])
    expect([...world.pending.values()].map(({ ms }) => ms)).toEqual([SYNC_RETRY_MS])
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(10)
    expect(world.store.read().owed).toEqual([])
    expect(world.pending.size).toBe(0)
  })

  it('keeps what the server did not take yet, and sends no play twice', async () => {
    const world = setup({ entries: [], owed: [owedFor()] })
    world.server.answer = async (call) => (call.name === 'recordPlay' ? NO_CONTENT : UNREACHABLE)
    await world.sync.runAll()
    expect(world.store.read().owed).toEqual([
      owedFor({ pending: { ...OWED_PENDING, play: false } }),
    ])
    world.server.answer = async () => NO_CONTENT
    await world.sync.runAll()
    expect(world.log.filter(({ name }) => name === 'recordPlay')).toHaveLength(1)
    expect(world.store.read().owed).toEqual([])
  })

  it.each([403, 404])(
    'drops an owed item the server answers %i for, and says so once without a path',
    async (status) => {
      const world = setup({ entries: [], owed: [owedFor(), owedFor({ mediaId: 12 })] })
      world.server.answer = async (call) =>
        call.name === 'recordPlay' && call.mediaId === 11
          ? { ok: true, status, body: '' }
          : NO_CONTENT
      await world.sync.runAll()
      expect(world.store.read().owed).toEqual([])
      expect(world.log.filter((call) => 'mediaId' in call && call.mediaId === 11)).toEqual([
        { name: 'recordPlay', mediaId: 11 },
      ])
      expect(world.warnings).toHaveLength(1)
      expect(world.warnings[0]).toContain(String(status))
      expect(world.warnings[0]).not.toContain('/api')
    },
  )

  it('keeps an owed item on a 500 without a word', async () => {
    const world = setup({ entries: [], owed: [owedFor()] })
    world.server.answer = async () => ({ ok: true, status: 500, body: '' })
    await world.sync.runAll()
    expect(world.store.read().owed).toEqual([owedFor()])
    expect(world.warnings).toEqual([])
  })

  it("sends a server's owed items and downloads one at a time, oldest pending first", async () => {
    const world = setup({
      entries: [
        entryFor({
          mediaId: 12,
          pending: { ...NO_PENDING, position: 40, furthest: 40, at: NOW + 2 },
        }),
      ],
      owed: [
        owedFor({
          mediaId: 13,
          pending: { ...NO_PENDING, position: 50, furthest: 50, at: NOW + 3 },
        }),
        owedFor({ pending: { ...NO_PENDING, position: 30, furthest: 30, at: NOW + 1 } }),
      ],
    })
    await world.sync.runAll()
    expect(world.log).toEqual([
      { name: 'saveProgress', mediaId: 11, position: 30 },
      { name: 'saveProgress', mediaId: 12, position: 40 },
      { name: 'saveProgress', mediaId: 13, position: 50 },
    ])
  })

  it('clears what a send carried from the owed item when its download was removed meanwhile', async () => {
    const world = setup()
    const held = gate()
    world.server.answer = (call) =>
      call.name === 'recordPlay' ? held.answer : Promise.resolve(UNREACHABLE)
    world.note({ play: true, position: 300 })
    const running = world.sync.runFor({ downloadIds: [ID] })
    await ticks(3)
    world.store.update((state) => remove(state, { downloadId: ID }))
    expect(world.store.read().owed).toHaveLength(1)
    held.open(NO_CONTENT)
    await running
    expect(world.store.read().owed).toEqual([
      {
        serverId: SERVER_ID,
        mediaId: 11,
        pending: { play: false, position: 300, furthest: 300, at: NOW },
      },
    ])
  })

  it('runFor leaves owed items to the runs of every download', async () => {
    const world = setup({ owed: [owedFor({ mediaId: 12 })] })
    world.note({ position: 300 })
    await world.sync.runFor({ downloadIds: [ID] })
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
    expect(world.store.read().owed).toHaveLength(1)
  })
})

describe('dispose', () => {
  it('clears the debounce and the retry timers, and starts nothing after', async () => {
    const world = setup()
    world.note({ position: 300 })
    expect(world.pending.size).toBe(2)
    world.sync.dispose()
    expect(world.pending.size).toBe(0)
    world.sync.touch({ downloadId: ID })
    await world.sync.runAll()
    expect(world.pending.size).toBe(0)
    expect(world.log).toEqual([])
  })

  it("lets a send already out finish, but starts no later download's send in its round", async () => {
    const pendingAt = (at: number) => ({ play: false, position: 300, furthest: 300, at })
    const world = setup({
      entries: [
        entryFor({ pending: pendingAt(NOW + 1) }),
        entryFor({ downloadId: OTHER_ID, mediaId: 12, pending: pendingAt(NOW + 2) }),
      ],
    })
    const held = gate()
    world.server.answer = () => held.answer
    const running = world.sync.runAll()
    await ticks(3)
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
    world.sync.dispose()
    held.open(NO_CONTENT)
    await running
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
    expect(world.pendingOf()?.position).toBeNull()
    expect(world.pendingOf(OTHER_ID)?.position).toBe(300)
  })
})

describe('settleWithin', () => {
  const setupWait = () => {
    const { timers, pending } = fakeTimers()
    const warnings: string[] = []
    const wait = (work: Promise<void>) =>
      settleWithin({ work, timers, ms: 2000, warn: (message) => warnings.push(message) })
    return { wait, pending, warnings }
  }

  it('settles when the work does, and clears its timer', async () => {
    const world = setupWait()
    await world.wait(Promise.resolve())
    expect(world.pending.size).toBe(0)
  })

  it('settles when the wait is over, though the work never does', async () => {
    const world = setupWait()
    const waiting = world.wait(new Promise(() => undefined))
    const [timer] = [...world.pending.values()]
    expect(timer?.ms).toBe(2000)
    timer?.run()
    await waiting
  })

  it('settles, and warns without a title, when the work rejects', async () => {
    const world = setupWait()
    await world.wait(Promise.reject(new Error('boom')))
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).toContain('boom')
    expect(world.pending.size).toBe(0)
  })
})
