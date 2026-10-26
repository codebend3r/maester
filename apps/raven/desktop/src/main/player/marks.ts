import type { monitorEventLoopDelay } from 'node:perf_hooks'
import { PLAYER_COMMANDS } from '@raven/core'
import type { PlayerService } from '@/main/player/playerService'
import type { Timers } from '@/main/stateStore'

export const LOOP_LAG_MS = 5000

type Histogram = Pick<
  ReturnType<typeof monitorEventLoopDelay>,
  'enable' | 'disable' | 'reset' | 'percentile'
>

const NS_PER_MS = 1e6

const COLD_OPEN_STAGES = { none: 'none', waiting: 'waiting', done: 'done' } as const

type CreateMarksProps = {
  isEnabled: boolean
  now: () => number
  write: (line: string) => void
  timers: Timers
  histogram: () => Histogram
}

/**
 * The budget marks (P5 Ruling 14, P7 Ruling 13): the first frame after each load, the cold
 * open to its first frame, and the main thread's p99 event loop delay while a video plays.
 */
export const createMarks = ({
  isEnabled,
  now,
  write,
  timers,
  histogram: makeHistogram,
}: CreateMarksProps) => {
  let loadedAt: number | null = null
  // The cold open is measured once a run: `waiting` from the first early `opened` until
  // its first frame, `done` after, so neither a later open nor a later frame measures again.
  let coldOpen:
    | { stage: typeof COLD_OPEN_STAGES.none }
    | { stage: typeof COLD_OPEN_STAGES.waiting; at: number }
    | { stage: typeof COLD_OPEN_STAGES.done } = { stage: COLD_OPEN_STAGES.none }
  let histogram: Histogram | null = null
  let timer: unknown = null

  const report = () => {
    if (histogram === null) return
    write(`raven-loop-lag-p99-ms ${Math.round(histogram.percentile(99) / NS_PER_MS)}\n`)
    histogram.reset()
    timer = timers.set({ run: report, ms: LOOP_LAG_MS })
  }

  const start = () => {
    if (timer !== null) return
    histogram ??= makeHistogram()
    histogram.enable()
    timer = timers.set({ run: report, ms: LOOP_LAG_MS })
  }

  const stop = () => {
    if (timer === null) return
    timers.clear(timer)
    timer = null
    if (histogram === null) return
    histogram.disable()
    histogram.reset()
  }

  return {
    /** The same service, noting when each load was asked for. */
    tracking: (service: PlayerService): PlayerService => ({
      ...service,
      handle: (command) => {
        if (command.type === PLAYER_COMMANDS.load) loadedAt = now()
        return service.handle(command)
      },
    }),
    /** A file opened before the window was ready, the cold "Open With" the budget times. */
    opened: () => {
      if (coldOpen.stage !== COLD_OPEN_STAGES.none) return
      coldOpen = { stage: COLD_OPEN_STAGES.waiting, at: now() }
    },
    firstFrame: () => {
      if (!isEnabled || loadedAt === null) return
      const at = now()
      write(`raven-first-frame-ms ${Math.round(at - loadedAt)}\n`)
      loadedAt = null
      if (coldOpen.stage !== COLD_OPEN_STAGES.waiting) return
      write(`raven-open-to-frame-ms ${Math.round(at - coldOpen.at)}\n`)
      coldOpen = { stage: COLD_OPEN_STAGES.done }
    },
    playing: (isPlaying: boolean) => {
      if (!isEnabled) return
      if (isPlaying) start()
      else stop()
    },
  }
}
