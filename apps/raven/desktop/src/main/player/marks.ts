import type { monitorEventLoopDelay } from 'node:perf_hooks'
import type { PlayerService } from '@/main/player/playerService'
import type { Timers } from '@/main/stateStore'

export const LOOP_LAG_MS = 5000

type Histogram = Pick<
  ReturnType<typeof monitorEventLoopDelay>,
  'enable' | 'disable' | 'reset' | 'percentile'
>

const NS_PER_MS = 1e6

/**
 * The budget marks (Ruling 14), on stdout until the log lands: the first frame after
 * each load, and the main thread's p99 event loop delay while a video plays.
 */
export const createMarks = ({
  isEnabled,
  now,
  write,
  timers,
  histogram: makeHistogram,
}: {
  isEnabled: boolean
  now: () => number
  write: (line: string) => void
  timers: Timers
  histogram: () => Histogram
}) => {
  let loadedAt: number | null = null
  let histogram: Histogram | null = null
  let timer: unknown = null

  const report = () => {
    if (histogram === null) return
    write(`raven-loop-lag-p99-ms ${Math.round(histogram.percentile(99) / NS_PER_MS)}\n`)
    histogram.reset()
    timer = timers.set(report, LOOP_LAG_MS)
  }

  const start = () => {
    if (timer !== null) return
    histogram ??= makeHistogram()
    histogram.enable()
    timer = timers.set(report, LOOP_LAG_MS)
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
        if (command.type === 'load') loadedAt = now()
        return service.handle(command)
      },
    }),
    firstFrame: () => {
      if (!isEnabled || loadedAt === null) return
      write(`raven-first-frame-ms ${Math.round(now() - loadedAt)}\n`)
      loadedAt = null
    },
    playing: (isPlaying: boolean) => {
      if (!isEnabled) return
      if (isPlaying) start()
      else stop()
    },
  }
}
