import { isWaitingOnOutage } from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import type { Timers } from '@/main/timers'

/** How often the files waiting on an outage are tried again, while any waits. */
export const OUTAGE_RETRY_MS = 300_000

/** How long a wake from sleep is given for the network to come back before files start again. */
export const RESUME_SETTLE_MS = 5000

type CreateQueueScheduleProps = {
  store: DownloadsStore
  timers: Timers
  /** The outage retry came due: every file waiting on an outage is requeued. */
  onRetry: () => void
  /** A wake from sleep has settled: the network has had its moment. */
  onAwake: () => void
}

export type QueueSchedule = {
  /** Arms the outage retry while any file waits on an outage, and drops it once none does. */
  syncOutageRetry: () => void
  /** Asleep from a suspend until the settle after the wake; nothing starts meanwhile. */
  isAsleep: () => boolean
  suspend: () => void
  /** Starts the settle; `onAwake` runs once it has passed. */
  wake: () => void
  dispose: () => void
}

/** The queue's two timers: the outage retry, and the settle after a wake from sleep. */
export const createQueueSchedule = ({
  store,
  timers,
  onRetry,
  onAwake,
}: CreateQueueScheduleProps): QueueSchedule => {
  let isDisposed = false
  let retry: unknown = undefined
  let settle: unknown = undefined
  let isAsleep = false

  const clearRetry = (): void => {
    timers.clear(retry)
    retry = undefined
  }

  const clearSettle = (): void => {
    timers.clear(settle)
    settle = undefined
  }

  return {
    syncOutageRetry: () => {
      if (isDisposed || !store.read().entries.some(isWaitingOnOutage)) {
        clearRetry()
        return
      }
      if (retry !== undefined) return
      retry = timers.set({
        run: () => {
          retry = undefined
          onRetry()
        },
        ms: OUTAGE_RETRY_MS,
      })
    },
    isAsleep: () => isAsleep,
    suspend: () => {
      isAsleep = true
      clearSettle()
    },
    wake: () => {
      clearSettle()
      settle = timers.set({
        run: () => {
          settle = undefined
          isAsleep = false
          onAwake()
        },
        ms: RESUME_SETTLE_MS,
      })
    },
    dispose: () => {
      isDisposed = true
      clearRetry()
      clearSettle()
    },
  }
}
