import { describe, expect, it } from 'bun:test'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  notePending,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { createSync, SYNC_DEBOUNCE_MS, SYNC_RETRY_MS } from '@/main/downloads/sync'
import type { AllowedCall } from '@/main/servers/allowlist'
import type { ServerCallResult } from '@/main/servers/serverCalls'
import type { JsonStore } from '@/main/stateStore'
import { ticks } from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
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

const setup = ({ entries = [entryFor()] }: { entries?: DownloadEntry[] } = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries })
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
    expect(world.pendingOf()).toEqual({ play: false, position: null, at: NOW })
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
    expect(world.pendingOf()).toEqual({ play: false, position: 360, at: NOW })
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log.slice(2)).toEqual([{ name: 'saveProgress', mediaId: 11, position: 360 }])
    expect(world.pendingOf()).toEqual({ play: false, position: null, at: NOW })
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
    held.open({ ok: false, message: 'unreachable' })
    await ticks(5)
    expect(world.log).toHaveLength(1)
    // The position saved meanwhile owes a send of its own, after a debounce.
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
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
    expect(world.pendingOf()).toEqual({ play: true, position: 300, at: NOW })
  })

  it('keeps the play when only the position fails, and does not send the play again', async () => {
    const world = setup()
    world.server.answer = async (call) =>
      call.name === 'saveProgress' ? { ok: false, message: 'unreachable' } : NO_CONTENT
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: false, position: 300, at: NOW })
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(5)
    expect(world.log.slice(2)).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
  })
})

describe('an answer that is no success', () => {
  it('keeps pending when the server is unreachable, and the retry timer sends it again', async () => {
    const world = setup()
    world.server.answer = async () => ({ ok: false, message: 'unreachable' })
    world.note({ play: true, position: 300 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.pendingOf()).toEqual({ play: true, position: 300, at: NOW })
    expect(world.warnings).toEqual([])
    expect([...world.pending.values()].map(({ ms }) => ms)).toEqual([SYNC_RETRY_MS])
    world.server.answer = async () => NO_CONTENT
    world.fireAt(SYNC_RETRY_MS)
    await ticks(5)
    expect(world.log.slice(1)).toEqual([
      { name: 'recordPlay', mediaId: 11 },
      { name: 'saveProgress', mediaId: 11, position: 300 },
    ])
    expect(world.pendingOf()).toEqual({ play: false, position: null, at: NOW })
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
    expect(world.pendingOf()).toEqual({ play: false, position: 300, at: NOW })
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

  it.each([401, 423, 500])('keeps pending on a %i without a word', async (status) => {
    const world = setup()
    world.server.answer = async () => ({ ok: true, status, body: '' })
    world.note({ play: true, position: 300 })
    await world.sync.runAll()
    expect(world.pendingOf()).toEqual({ play: true, position: 300, at: NOW })
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
    expect(world.pendingOf()).toEqual({ play: false, position: 300, at: NOW })
  })
})

describe('runAll', () => {
  it('sends at once what every download has pending, and nothing for one with nothing pending', async () => {
    const other = entryFor({ downloadId: OTHER_ID, mediaId: 12 })
    const world = setup({ entries: [entryFor(), other] })
    world.note({ position: 300 })
    await world.sync.runAll()
    expect(world.log).toEqual([{ name: 'saveProgress', mediaId: 11, position: 300 }])
    expect(world.pendingOf()).toEqual({ play: false, position: null, at: NOW })
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
})
