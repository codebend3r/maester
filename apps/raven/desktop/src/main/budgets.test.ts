import { describe, expect, test } from 'bun:test'
import {
  BUDGET_STATES,
  BUDGETS,
  budgetWindowFrom,
  createBudgets,
  type MetricLike,
  stateOf,
  sumMetrics,
  syncRetryFrom,
} from '@/main/budgets'
import { SYNC_RETRY_MS } from '@/main/downloads/sync'
import { fakeTimers } from '@/main/test/playerFakes'

const WINDOW_MS = 60_000
const SAMPLE_MS = 10_000

const HOME = { isPlaying: false, isShowing: false } as const
const PLAYING = { isPlaying: true, isShowing: true } as const
const PAUSED = { isPlaying: false, isShowing: true } as const

const metric = ({ kb, cpu }: { kb: number; cpu: number }): MetricLike => ({
  memory: { workingSetSize: kb },
  cpu: { percentCPUUsage: cpu },
})

const setup = () => {
  const lines: string[] = []
  const reads = { count: 0 }
  const current: { metrics: readonly MetricLike[] } = {
    metrics: [metric({ kb: 204_800, cpu: 0.4 }), metric({ kb: 102_400, cpu: 1.25 })],
  }
  const timers = fakeTimers()
  const budgets = createBudgets({
    metrics: () => {
      reads.count += 1
      return current.metrics
    },
    timers: timers.timers,
    mark: (line) => lines.push(line),
    windowMs: WINDOW_MS,
    sampleMs: SAMPLE_MS,
  })
  const delays = () => [...timers.pending.values()].map(({ ms }) => ms)
  return { budgets, lines, reads, current, timers, delays }
}

describe('sumMetrics', () => {
  test('adds the working sets into whole MB and the CPU to one decimal', () => {
    expect(
      sumMetrics([metric({ kb: 204_800, cpu: 0.4 }), metric({ kb: 102_400, cpu: 1.25 })]),
    ).toEqual({ memoryMb: 300, cpuPercent: 1.7 })
  })

  test('nothing running is nothing used', () => {
    expect(sumMetrics([])).toEqual({ memoryMb: 0, cpuPercent: 0 })
  })
})

describe('stateOf', () => {
  test('nothing showing is Home, whether or not it plays', () => {
    expect(stateOf(HOME)).toBe(BUDGET_STATES.home)
    expect(stateOf({ isPlaying: true, isShowing: false })).toBe(BUDGET_STATES.home)
  })

  test('a video showing is playing or paused', () => {
    expect(stateOf(PLAYING)).toBe(BUDGET_STATES.playing)
    expect(stateOf(PAUSED)).toBe(BUDGET_STATES.paused)
  })
})

describe('createBudgets', () => {
  test('Home writes one idle memory mark after the window', () => {
    const { lines, timers, delays } = setup()
    expect(delays()).toEqual([WINDOW_MS])
    timers.fire()
    expect(lines).toEqual(['raven-memory-idle-mb 300\n'])
    expect(timers.pending.size).toBe(0)
  })

  test('leaving Home before the window writes no idle mark', () => {
    const { budgets, lines, timers } = setup()
    budgets.report(PLAYING)
    budgets.report(HOME)
    budgets.dispose()
    timers.fire()
    expect(lines).toEqual([])
  })

  test('coming back to Home from a video starts a new window with one idle mark', () => {
    const { budgets, lines, timers, delays } = setup()
    budgets.report(PLAYING)
    budgets.report(HOME)
    expect(delays()).toEqual([WINDOW_MS])
    timers.fire()
    expect(lines).toEqual(['raven-memory-idle-mb 300\n'])
    expect(timers.pending.size).toBe(0)
  })

  test('playing writes a memory mark at each sample and stops when paused', () => {
    const { budgets, lines, timers, delays, current } = setup()
    budgets.report(PLAYING)
    expect(delays()).toEqual([SAMPLE_MS])
    timers.fire()
    current.metrics = [metric({ kb: 512_000, cpu: 30 })]
    expect(delays()).toEqual([SAMPLE_MS])
    timers.fire()
    expect(lines).toEqual(['raven-memory-playing-mb 300\n', 'raven-memory-playing-mb 500\n'])
    budgets.report(PAUSED)
    expect(delays()).toEqual([WINDOW_MS])
    expect(lines).toHaveLength(2)
  })

  test('paused reads the metrics at the start and writes one CPU mark after the window', () => {
    const { budgets, lines, reads, timers, delays, current } = setup()
    budgets.report(PAUSED)
    expect(reads.count).toBe(1)
    expect(delays()).toEqual([WINDOW_MS])
    current.metrics = [metric({ kb: 300_000, cpu: 0.84 }), metric({ kb: 1000, cpu: 0.2 })]
    timers.fire()
    expect(reads.count).toBe(2)
    expect(lines).toEqual(['raven-cpu-paused-percent 1\n'])
    expect(timers.pending.size).toBe(0)
  })

  test('the same state again does not restart its window', () => {
    const { budgets, lines, reads, timers } = setup()
    budgets.report(PAUSED)
    const [first] = [...timers.pending.keys()]
    budgets.report(PAUSED)
    budgets.report(PAUSED)
    expect([...timers.pending.keys()]).toEqual([first ?? -1])
    expect(reads.count).toBe(1)
    timers.fire()
    expect(lines).toEqual(['raven-cpu-paused-percent 1.7\n'])
  })

  test('nothing is written or read once disposed', () => {
    const { budgets, lines, reads, timers } = setup()
    budgets.dispose()
    budgets.report(PAUSED)
    budgets.report(PLAYING)
    timers.fire()
    expect(timers.pending.size).toBe(0)
    expect(reads.count).toBe(0)
    expect(lines).toEqual([])
  })

  test('the budgets are the spec values', () => {
    expect(BUDGETS).toEqual({ idleMemoryMb: 300, playingMemoryMb: 700, pausedCpuPercent: 2 })
  })
})

describe('budgetWindowFrom', () => {
  const env = (value: string | undefined) => ({ RAVEN_DESKTOP_BUDGET_MS: value })

  test('a packaged app never reads the hook', () => {
    expect(budgetWindowFrom({ isPackaged: true, env: env('2000') })).toBeNull()
  })

  test('unpackaged, only a whole number from 100 to 600000 counts', () => {
    expect(budgetWindowFrom({ isPackaged: false, env: env(undefined) })).toBeNull()
    expect(budgetWindowFrom({ isPackaged: false, env: env('abc') })).toBeNull()
    expect(budgetWindowFrom({ isPackaged: false, env: env('50') })).toBeNull()
    expect(budgetWindowFrom({ isPackaged: false, env: env('700000') })).toBeNull()
    expect(budgetWindowFrom({ isPackaged: false, env: env('1500.5') })).toBeNull()
    expect(budgetWindowFrom({ isPackaged: false, env: env('2000') })).toBe(2000)
    expect(budgetWindowFrom({ isPackaged: false, env: env('100') })).toBe(100)
    expect(budgetWindowFrom({ isPackaged: false, env: env('600000') })).toBe(600_000)
  })
})

describe('syncRetryFrom', () => {
  const env = (value: string | undefined) => ({ RAVEN_DESKTOP_SYNC_RETRY_MS: value })

  test('a packaged app never reads the hook', () => {
    expect(syncRetryFrom({ isPackaged: true, env: env('2000') })).toBeNull()
  })

  test('unpackaged, only a whole number from 100 to the five minutes it shortens counts', () => {
    expect(syncRetryFrom({ isPackaged: false, env: env(undefined) })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('abc') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('0') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('-2000') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('1500.5') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('300001') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('1') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('99') })).toBeNull()
    expect(syncRetryFrom({ isPackaged: false, env: env('100') })).toBe(100)
    expect(syncRetryFrom({ isPackaged: false, env: env('2000') })).toBe(2000)
    expect(syncRetryFrom({ isPackaged: false, env: env('300000') })).toBe(SYNC_RETRY_MS)
  })

  test('reads only its own hook', () => {
    expect(
      syncRetryFrom({ isPackaged: false, env: { RAVEN_DESKTOP_BUDGET_MS: '2000' } }),
    ).toBeNull()
  })
})
