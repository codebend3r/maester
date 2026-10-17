/**
 * `items.map(fn)` with at most `limit` calls in flight, results in input
 * order. Used wherever the NAS is on the other end: a thousand parallel
 * `stat` or ffprobe calls over SMB are slower than sixteen, not faster.
 */
export const mapWithConcurrency = async <T, R>({
  items,
  limit,
  fn,
}: {
  items: readonly T[]
  limit: number
  fn: (item: T) => Promise<R>
}): Promise<R[]> => {
  const results = new Map<number, R>()
  const cursor = { next: 0 }

  const worker = async (): Promise<void> => {
    const index = cursor.next
    cursor.next += 1
    if (index >= items.length) return
    results.set(index, await fn(items[index]))
    return worker()
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return [...results.entries()].toSorted(([a], [b]) => a - b).map(([, value]) => value)
}

export type Gate = {
  /** Runs `task` once fewer than the gate's limit are running, queueing it until then. */
  run: <T>(task: () => Promise<T>) => Promise<T>
}

/**
 * A limit shared by every caller that holds the same gate, unlike
 * `mapWithConcurrency`, whose limit covers one call. Waiters go in arrival
 * order, and a task that fails still frees its place.
 */
export const createGate = ({ limit }: { limit: number }): Gate => {
  const state = { running: 0 }
  const waiting: Array<() => void> = []

  const release = (): void => {
    state.running -= 1
    waiting.shift()?.()
  }

  const acquire = (): Promise<void> => {
    if (state.running < Math.max(1, limit)) {
      state.running += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      waiting.push(() => {
        state.running += 1
        resolve()
      })
    })
  }

  return {
    run: async (task) => {
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}

export type TaskQueue = {
  /** Queues `task` under `key`; a key already queued or running is ignored. */
  push: (args: { key: string; task: () => Promise<void> }) => void
  /**
   * Like `push`, but a key that is running is queued once more, to run
   * after it: for work that changed what the running task has already read.
   */
  again: (args: { key: string; task: () => Promise<void> }) => void
  /** Drops a queued task that has not started yet. */
  cancel: (key: string) => void
  /** Resolves once nothing is queued or running. */
  idle: () => Promise<void>
  size: () => number
}

/**
 * A keyed background queue with fixed concurrency, for work that trickles in
 * from scans and should neither block them nor run twice for the same file.
 * A task that throws is dropped; tasks record their own failures.
 */
export const createTaskQueue = ({ concurrency }: { concurrency: number }): TaskQueue => {
  const queued = new Map<string, () => Promise<void>>()
  const running = new Set<string>()
  // Tasks asked for again while their key ran; each is queued once it ends.
  const after = new Map<string, () => Promise<void>>()
  const waiters = new Set<() => void>()

  const settle = (): void => {
    if (queued.size > 0 || running.size > 0) return
    waiters.forEach((resolve) => resolve())
    waiters.clear()
  }

  const pump = (): void => {
    if (running.size >= concurrency) return settle()
    const next = queued.entries().next()
    if (next.done) return settle()
    const [key, task] = next.value
    queued.delete(key)
    running.add(key)
    void task()
      .catch(() => undefined)
      .finally(() => {
        running.delete(key)
        const rerun = after.get(key)
        after.delete(key)
        if (rerun) queued.set(key, rerun)
        pump()
      })
    pump()
  }

  return {
    push: ({ key, task }) => {
      if (queued.has(key) || running.has(key)) return
      queued.set(key, task)
      pump()
    },
    again: ({ key, task }) => {
      if (queued.has(key)) return
      if (running.has(key)) after.set(key, task)
      else queued.set(key, task)
      pump()
    },
    cancel: (key) => {
      queued.delete(key)
      after.delete(key)
      settle()
    },
    idle: () =>
      queued.size === 0 && running.size === 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            waiters.add(resolve)
          }),
    size: () => queued.size + running.size + after.size,
  }
}

export type RateLimit = {
  /** Runs `task` in its turn: at most `inFlight` at once, started no faster than the rate. */
  run: <T>(task: () => Promise<T>) => Promise<T>
  /** Halves the rate, after a server asked us to slow down. */
  slowDown: () => void
  /** Back to the starting rate. */
  reset: () => void
}

/**
 * A gate that also spaces out starts, for an API with a ceiling on requests
 * a second. Starts are booked a slot apart, so a burst queues rather than
 * tripping the ceiling.
 */
export const createRateLimit = ({
  perSecond,
  inFlight,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  perSecond: number
  inFlight: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): RateLimit => {
  const gate = createGate({ limit: inFlight })
  const state = { rate: perSecond, next: 0 }

  const turn = async (): Promise<void> => {
    const at = Math.max(now(), state.next)
    state.next = at + 1000 / state.rate
    const wait = at - now()
    if (wait > 0) await sleep(wait)
  }

  return {
    run: (task) =>
      gate.run(async () => {
        await turn()
        return task()
      }),
    slowDown: () => {
      state.rate = Math.max(1, state.rate / 2)
    },
    reset: () => {
      state.rate = perSecond
    },
  }
}
