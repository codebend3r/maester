import type { Timers } from '@/main/stateStore'
import { createNodeTimers } from '@/main/timers'

export const BOUNDED_OUTCOMES = { answered: 'answered', late: 'late', failed: 'failed' } as const

/** The `AbortSignal` event a stopped run listens for. */
export const SIGNAL_EVENTS = { abort: 'abort' } as const

type Bounded<T> =
  | { outcome: typeof BOUNDED_OUTCOMES.answered; result: T }
  | { outcome: typeof BOUNDED_OUTCOMES.late }
  | { outcome: typeof BOUNDED_OUTCOMES.failed; error: unknown }

const NODE_TIMERS = createNodeTimers()

/** The task's answer, or why there is none: it rejected, or did not answer within `ms`. */
export const within = async <T>({
  task,
  ms,
  timers = NODE_TIMERS,
}: {
  task: Promise<T>
  ms: number
  timers?: Timers
}): Promise<Bounded<T>> => {
  const timer: { handle: unknown } = { handle: null }
  const timeout = new Promise<Bounded<T>>((resolve) => {
    timer.handle = timers.set({ run: () => resolve({ outcome: BOUNDED_OUTCOMES.late }), ms })
  })
  const answer = task.then(
    (result): Bounded<T> => ({ outcome: BOUNDED_OUTCOMES.answered, result }),
    (error: unknown): Bounded<T> => ({ outcome: BOUNDED_OUTCOMES.failed, error }),
  )
  try {
    return await Promise.race([answer, timeout])
  } finally {
    timers.clear(timer.handle)
  }
}

/** Settles with null as soon as `signal` aborts, so a stopped run never waits on a slow server. */
export const unlessStopped = <T>({
  task,
  signal,
}: {
  task: Promise<T>
  signal: AbortSignal
}): Promise<T | null> => {
  if (signal.aborted) return Promise.resolve(null)
  const stopped = Promise.withResolvers<null>()
  const onAbort = (): void => stopped.resolve(null)
  signal.addEventListener(SIGNAL_EVENTS.abort, onAbort, { once: true })
  return Promise.race([task, stopped.promise]).finally(() =>
    signal.removeEventListener(SIGNAL_EVENTS.abort, onAbort),
  )
}
