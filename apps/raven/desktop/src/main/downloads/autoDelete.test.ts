import { describe, expect, it } from 'bun:test'
import { AUTO_DELETE_DELAY_MS, createAutoDelete } from '@/main/downloads/autoDelete'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  remove,
  setAutoDelete,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { JsonStore } from '@/main/stateStore'
import { ticks } from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_ID = '00000000-0000-4000-8000-0000000000a1'
const NOW = 1_700_000_000_000
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const GIB = 1024 ** 3

/** A ready episode set to delete once watched, watched just now. */
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
  autoDelete: true,
  watchedAt: NOW,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: NOW - 1000,
  track: undefined,
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

type SetupProps = { entries?: DownloadEntry[] }

const setup = ({ entries = [entryFor()] }: SetupProps = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries })
  const { timers, pending } = fakeTimers()
  const clock = { now: NOW }
  const playing = new Set<string>()
  const midTitle = new Set<string>()
  const removed: string[] = []
  const deleted: string[] = []
  const warnings: string[] = []
  /** What each removal waits on before it removes. */
  const removal: { hold: Promise<void> } = { hold: Promise.resolve() }
  const autoDelete = createAutoDelete({
    store,
    timers,
    now: () => clock.now,
    isPlaying: (downloadId) => playing.has(downloadId),
    isMidTitle: (downloadId) => midTitle.has(downloadId),
    remove: async (downloadId) => {
      removed.push(downloadId)
      await removal.hold
      // As the service does once its wait for the server is over: it looks again.
      const entry = store.read().entries.find((held) => held.downloadId === downloadId)
      const isKept =
        entry === undefined ||
        !entry.autoDelete ||
        playing.has(downloadId) ||
        midTitle.has(downloadId)
      if (isKept) return false
      store.update((state) => remove(state, { downloadId }))
      return true
    },
    onDeleted: (entry) => deleted.push(entry.label),
    warn: (message) => warnings.push(message),
  })
  /** Lets `ms` go by, then runs the timers set for that long, as the clock would. */
  const after = (ms: number): void => {
    clock.now += ms
    const due = [...pending].filter(([, timer]) => timer.ms === ms)
    due.forEach(([handle, timer]) => {
      pending.delete(handle)
      timer.run()
    })
  }
  const delays = () => [...pending.values()].map(({ ms }) => ms)
  return {
    autoDelete,
    store,
    pending,
    clock,
    playing,
    midTitle,
    removed,
    deleted,
    warnings,
    removal,
    after,
    delays,
  }
}

describe('constants', () => {
  it("waits the spec's ten minutes", () => {
    expect(AUTO_DELETE_DELAY_MS).toBe(600_000)
  })
})

describe('the clock', () => {
  it('deletes a download ten minutes after it counts as watched, and tells of it', async () => {
    const world = setup()
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.delays()).toEqual([AUTO_DELETE_DELAY_MS])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBe(NOW + AUTO_DELETE_DELAY_MS)
    expect(world.removed).toEqual([])
    world.after(AUTO_DELETE_DELAY_MS)
    expect(world.removed).toEqual([ID])
    await ticks(3)
    expect(world.deleted).toEqual(['S01E01 Good News'])
    expect(world.store.read().entries).toEqual([])
  })

  it('resumes at launch with what is left of the ten minutes', () => {
    const world = setup({ entries: [entryFor({ watchedAt: NOW - 3 * MINUTE })] })
    world.autoDelete.rebuild()
    expect(world.delays()).toEqual([7 * MINUTE])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBe(NOW + 7 * MINUTE)
  })

  it('deletes at once at launch when the ten minutes ran out while Raven was closed', async () => {
    const world = setup({ entries: [entryFor({ watchedAt: NOW - 11 * MINUTE })] })
    world.autoDelete.rebuild()
    expect(world.removed).toEqual([ID])
    expect(world.pending.size).toBe(0)
    await ticks(3)
    expect(world.deleted).toEqual(['S01E01 Good News'])
  })

  it('arms one clock per ready download set to delete once watched, and none for the rest', () => {
    const idOf = (n: number): string => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
    const world = setup({
      entries: [
        entryFor({ watchedAt: NOW - MINUTE }),
        entryFor({ downloadId: OTHER_ID, mediaId: 12, watchedAt: NOW - 2 * MINUTE }),
        entryFor({ downloadId: idOf(3), mediaId: 13, status: { kind: 'queued' } }),
        entryFor({
          downloadId: idOf(4),
          mediaId: 14,
          status: { kind: 'paused', bytes: 7, reason: 'viewer' },
        }),
        entryFor({ downloadId: idOf(5), mediaId: 15, autoDelete: false }),
        entryFor({ downloadId: idOf(6), mediaId: 16, watchedAt: null }),
      ],
    })
    world.autoDelete.rebuild()
    expect(world.delays().toSorted()).toEqual([8 * MINUTE, 9 * MINUTE])
    expect(world.autoDelete.deletesAt({ downloadId: idOf(3) })).toBeNull()
    world.autoDelete.rebuild()
    expect(world.pending.size).toBe(2)
  })

  it('starts the ten minutes from the switch when it is turned on for a title already watched', () => {
    const world = setup({
      entries: [entryFor({ autoDelete: false, watchedAt: NOW - 30 * MINUTE })],
    })
    world.autoDelete.rebuild()
    expect(world.pending.size).toBe(0)
    world.store.update((state) =>
      setAutoDelete(state, { downloadId: ID, autoDelete: true, at: NOW }),
    )
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.removed).toEqual([])
    expect(world.delays()).toEqual([AUTO_DELETE_DELAY_MS])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBe(NOW + AUTO_DELETE_DELAY_MS)
  })

  it('counts from the switch after a relaunch too, not from when the title was watched', () => {
    const world = setup({ entries: [entryFor({ autoDelete: false, watchedAt: NOW - DAY })] })
    world.store.update((state) =>
      setAutoDelete(state, { downloadId: ID, autoDelete: true, at: NOW }),
    )
    world.clock.now = NOW + 5 * MINUTE
    world.autoDelete.rebuild()
    expect(world.removed).toEqual([])
    expect(world.delays()).toEqual([5 * MINUTE])
  })

  it('deletes at once a download overdue when its first position is noted', () => {
    const world = setup({ entries: [entryFor({ watchedAt: NOW - 11 * MINUTE })] })
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.removed).toEqual([ID])
  })

  it('keeps the clock it has when a later position is noted', () => {
    const world = setup()
    world.autoDelete.schedule({ downloadId: ID })
    world.clock.now += 3 * MINUTE
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.pending.size).toBe(1)
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBe(NOW + AUTO_DELETE_DELAY_MS)
  })

  it('cancel disarms the clock', () => {
    const world = setup()
    world.autoDelete.schedule({ downloadId: ID })
    world.autoDelete.cancel({ downloadId: ID })
    expect(world.pending.size).toBe(0)
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBeNull()
    world.after(AUTO_DELETE_DELAY_MS)
    expect(world.removed).toEqual([])
  })

  it('disarms the clock of a download no longer set to delete once watched', () => {
    const world = setup()
    world.autoDelete.schedule({ downloadId: ID })
    world.store.update((state) =>
      setAutoDelete(state, { downloadId: ID, autoDelete: false, at: NOW }),
    )
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.pending.size).toBe(0)
  })

  it('removes nothing for a download that went another way before its time came', async () => {
    const world = setup()
    world.autoDelete.schedule({ downloadId: ID })
    world.store.update((state) => remove(state, { downloadId: ID }))
    world.after(AUTO_DELETE_DELAY_MS)
    await ticks(3)
    expect(world.removed).toEqual([])
    expect(world.deleted).toEqual([])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBeNull()
  })
})

describe('a sleep', () => {
  it('arms a running clock again from its time, so a deletion due during the sleep runs at once', () => {
    const world = setup()
    world.autoDelete.schedule({ downloadId: ID })
    // A timer stands still while the Mac sleeps, though the clock on the wall does not.
    world.clock.now += 30 * MINUTE
    world.autoDelete.rearm()
    expect(world.removed).toEqual([ID])
    expect(world.pending.size).toBe(0)
  })

  it('arms a clock still running again with what is left, and leaves a held one held', () => {
    const world = setup({
      entries: [entryFor(), entryFor({ downloadId: OTHER_ID, mediaId: 12, watchedAt: NOW - DAY })],
    })
    world.playing.add(OTHER_ID)
    world.autoDelete.rebuild()
    expect(world.autoDelete.deletesAt({ downloadId: OTHER_ID })).toBeNull()
    world.clock.now += 4 * MINUTE
    world.autoDelete.rearm()
    expect(world.delays()).toEqual([6 * MINUTE])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBe(NOW + AUTO_DELETE_DELAY_MS)
    expect(world.removed).toEqual([])
    world.after(6 * MINUTE)
    expect(world.removed).toEqual([ID])
  })
})

describe('a wait longer than a timer holds', () => {
  const TIMER_MAX_MS = 2 ** 31 - 1

  it('waits at most what a timer holds, and on from there, never deleting early', () => {
    // Watched by a clock thirty days ahead, which has since been put right.
    const world = setup({ entries: [entryFor({ watchedAt: NOW + 30 * DAY })] })
    world.autoDelete.rebuild()
    expect(world.delays()).toEqual([TIMER_MAX_MS])
    world.after(TIMER_MAX_MS)
    expect(world.removed).toEqual([])
    const left = 30 * DAY + AUTO_DELETE_DELAY_MS - TIMER_MAX_MS
    expect(world.delays()).toEqual([left])
    world.after(left)
    expect(world.removed).toEqual([ID])
  })
})

describe('a deletion that waits', () => {
  it('holds a deletion that comes due while its file plays, and runs it once playback leaves', async () => {
    const world = setup()
    world.playing.add(ID)
    world.autoDelete.schedule({ downloadId: ID })
    world.after(AUTO_DELETE_DELAY_MS)
    expect(world.removed).toEqual([])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBeNull()
    world.autoDelete.playbackLeft()
    expect(world.removed).toEqual([])
    world.playing.delete(ID)
    world.autoDelete.playbackLeft()
    expect(world.removed).toEqual([ID])
    await ticks(3)
    expect(world.deleted).toEqual(['S01E01 Good News'])
  })

  it('holds a deletion while the title is left partway, and runs it once a position clears that', () => {
    const world = setup()
    world.midTitle.add(ID)
    world.autoDelete.schedule({ downloadId: ID })
    world.after(AUTO_DELETE_DELAY_MS)
    world.autoDelete.playbackLeft()
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.removed).toEqual([])
    world.midTitle.delete(ID)
    world.autoDelete.schedule({ downloadId: ID })
    expect(world.removed).toEqual([ID])
  })

  it('tells of a deletion only once the removal is done', async () => {
    const world = setup()
    const held = Promise.withResolvers<void>()
    world.removal.hold = held.promise
    world.autoDelete.schedule({ downloadId: ID })
    world.after(AUTO_DELETE_DELAY_MS)
    expect(world.removed).toEqual([ID])
    await ticks(3)
    expect(world.deleted).toEqual([])
    held.resolve()
    await ticks(3)
    expect(world.deleted).toEqual(['S01E01 Good News'])
  })

  it('starts one removal however often it is asked while one is under way', async () => {
    const world = setup()
    const held = Promise.withResolvers<void>()
    world.removal.hold = held.promise
    world.autoDelete.schedule({ downloadId: ID })
    world.after(AUTO_DELETE_DELAY_MS)
    world.autoDelete.schedule({ downloadId: ID })
    world.autoDelete.playbackLeft()
    world.autoDelete.rebuild()
    expect(world.removed).toEqual([ID])
    expect(world.pending.size).toBe(0)
    held.resolve()
    await ticks(3)
    expect(world.deleted).toEqual(['S01E01 Good News'])
  })

  it('holds a download the removal kept because it was opened meanwhile, until playback leaves', async () => {
    const world = setup()
    const held = Promise.withResolvers<void>()
    world.removal.hold = held.promise
    world.autoDelete.schedule({ downloadId: ID })
    world.after(AUTO_DELETE_DELAY_MS)
    world.playing.add(ID)
    held.resolve()
    await ticks(3)
    expect(world.store.read().entries).toHaveLength(1)
    expect(world.deleted).toEqual([])
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBeNull()
    world.playing.delete(ID)
    world.autoDelete.playbackLeft()
    await ticks(3)
    expect(world.removed).toEqual([ID, ID])
    expect(world.deleted).toEqual(['S01E01 Good News'])
  })

  it('leaves alone a download switched off while its removal waited', async () => {
    const world = setup()
    const held = Promise.withResolvers<void>()
    world.removal.hold = held.promise
    world.autoDelete.schedule({ downloadId: ID })
    world.after(AUTO_DELETE_DELAY_MS)
    world.store.update((state) =>
      setAutoDelete(state, { downloadId: ID, autoDelete: false, at: NOW }),
    )
    world.autoDelete.cancel({ downloadId: ID })
    held.resolve()
    await ticks(3)
    world.autoDelete.playbackLeft()
    await ticks(3)
    expect(world.store.read().entries).toHaveLength(1)
    expect(world.removed).toEqual([ID])
    expect(world.deleted).toEqual([])
    expect(world.pending.size).toBe(0)
  })
})

describe('dispose', () => {
  it('clears every clock and arms none after', () => {
    const world = setup({
      entries: [
        entryFor({ watchedAt: NOW - MINUTE }),
        entryFor({ downloadId: OTHER_ID, mediaId: 12, watchedAt: NOW - 2 * MINUTE }),
      ],
    })
    world.autoDelete.rebuild()
    expect(world.pending.size).toBe(2)
    world.autoDelete.dispose()
    expect(world.pending.size).toBe(0)
    world.autoDelete.schedule({ downloadId: ID })
    world.autoDelete.rebuild()
    expect(world.pending.size).toBe(0)
    expect(world.autoDelete.deletesAt({ downloadId: ID })).toBeNull()
  })
})
