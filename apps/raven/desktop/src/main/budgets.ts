import type { PlayerActivity } from '@/main/player/playerService'
import type { Timers } from '@/main/stateStore'

/** How long Home or a pause lasts before its mark (Ruling 13). */
export const BUDGET_WINDOW_MS = 60_000
/** How often memory is marked while a video plays. */
export const PLAYING_SAMPLE_MS = 10_000
/** The spec's budgets, in MB and in percent of one core. */
export const BUDGETS = { idleMemoryMb: 300, playingMemoryMb: 700, pausedCpuPercent: 2 } as const

const BUDGET_HOOK = 'RAVEN_DESKTOP_BUDGET_MS'
const HOOK_MIN_MS = 100
const HOOK_MAX_MS = 600_000
const WHOLE_NUMBER = /^\d+$/

/** The part of Electron's `ProcessMetric` the budgets read. */
export type MetricLike = { memory: { workingSetSize: number }; cpu: { percentCPUUsage: number } }

/** Working sets are in KB; 100 percent is one full core. */
export const sumMetrics = (
  metrics: readonly MetricLike[],
): { memoryMb: number; cpuPercent: number } => {
  const total = metrics.reduce(
    (sum, { memory, cpu }) => ({
      kb: sum.kb + memory.workingSetSize,
      cpu: sum.cpu + cpu.percentCPUUsage,
    }),
    { kb: 0, cpu: 0 },
  )
  return { memoryMb: Math.round(total.kb / 1024), cpuPercent: Math.round(total.cpu * 10) / 10 }
}

export const BUDGET_STATES = { home: 'home', playing: 'playing', paused: 'paused' } as const

export type BudgetState = (typeof BUDGET_STATES)[keyof typeof BUDGET_STATES]

export const stateOf = (activity: PlayerActivity): BudgetState => {
  if (!activity.isShowing) return BUDGET_STATES.home
  return activity.isPlaying ? BUDGET_STATES.playing : BUDGET_STATES.paused
}

/**
 * Marks memory on Home and while playing, and CPU while paused, restarting its timer only
 * when the state changes. Reports after `dispose` are ignored: the player can still report
 * while its window closes.
 */
export const createBudgets = ({
  metrics,
  timers,
  mark,
  windowMs,
  sampleMs,
}: {
  metrics: () => readonly MetricLike[]
  timers: Timers
  mark: (line: string) => void
  windowMs: number
  sampleMs: number
}): { report: (activity: PlayerActivity) => void; dispose: () => void } => {
  let state: BudgetState = BUDGET_STATES.home
  let timer: unknown = null
  let isDisposed = false

  const sample = () => {
    timer = timers.set({
      run: () => {
        mark(`raven-memory-playing-mb ${sumMetrics(metrics()).memoryMb}\n`)
        sample()
      },
      ms: sampleMs,
    })
  }

  const start = (next: BudgetState) => {
    switch (next) {
      case BUDGET_STATES.home:
        timer = timers.set({
          run: () => {
            timer = null
            mark(`raven-memory-idle-mb ${sumMetrics(metrics()).memoryMb}\n`)
          },
          ms: windowMs,
        })
        return
      case BUDGET_STATES.playing:
        sample()
        return
      case BUDGET_STATES.paused:
        // Electron's CPU figure covers the time since the previous call, so this one starts it.
        metrics()
        timer = timers.set({
          run: () => {
            timer = null
            mark(`raven-cpu-paused-percent ${sumMetrics(metrics()).cpuPercent}\n`)
          },
          ms: windowMs,
        })
        return
      default: {
        const unreachable: never = next
        return unreachable
      }
    }
  }

  const stop = () => {
    if (timer === null) return
    timers.clear(timer)
    timer = null
  }

  start(state)

  return {
    report: (activity) => {
      if (isDisposed) return
      const next = stateOf(activity)
      if (next === state) return
      stop()
      state = next
      start(next)
    },
    dispose: () => {
      isDisposed = true
      stop()
    },
  }
}

/** The test hook's window, read only unpackaged; null leaves the spec's 60 s and 10 s. */
export const budgetWindowFrom = ({
  isPackaged,
  env,
}: {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
}): number | null => {
  if (isPackaged) return null
  const value = env[BUDGET_HOOK] ?? ''
  if (!WHOLE_NUMBER.test(value)) return null
  const ms = Number(value)
  return ms >= HOOK_MIN_MS && ms <= HOOK_MAX_MS ? ms : null
}
