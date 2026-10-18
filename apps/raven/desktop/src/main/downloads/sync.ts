import { entryById, clearPending, type DownloadEntry } from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { errorText } from '@/main/log/errorText'
import type { AllowedCall } from '@/main/servers/allowlist'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/stateStore'

/** A play or a position waits this long before it goes out, so a playing download reports as a stream would. */
export const SYNC_DEBOUNCE_MS = 2000
/** While anything is pending, the server is tried again this often. */
export const SYNC_RETRY_MS = 300_000

export type SyncDeps = {
  store: DownloadsStore
  calls: Pick<ServerCalls, 'call'>
  timers: Timers
  warn: (message: string) => void
}

export type Sync = {
  /** A download has something new pending; it goes out once the debounce has run. */
  touch: (input: { downloadId: string }) => void
  /** Sends what every download has pending now; settles once the answers are in. */
  runAll: () => Promise<void>
  /** Sends what these downloads have pending now; settles once the answers are in. */
  runFor: (input: { downloadIds: readonly string[] }) => Promise<void>
  /**
   * Clears every timer; a send already out finishes and is not followed up. Quitting waits on
   * it through the server calls' `settleWrites`, which settles before the stores flush, and a
   * clear that comes a tick late leaves the store dirty for the quit gate's second flush.
   * Whatever is not cleared is sent at the next launch.
   */
  dispose: () => void
}

const hasPending = ({ pending }: DownloadEntry): boolean =>
  pending.play || pending.position !== null || pending.furthest !== null

const isSuccess = (status: number): boolean => status >= 200 && status < 300

/** The statuses that say the server will never take this, or not yet, and are worth a line in the log. */
const isLogged = (status: number): boolean => status === 403 || status === 404

/** How a call went: the server took it, answered something else, or could not be reached. */
type Delivery = 'taken' | 'refused' | 'unreachable'

/**
 * Each server's due downloads, oldest pending first: a server hears its downloads one at a time
 * in the order they were made, so each report replaces the one before as it did when made.
 */
const queuesByServer = (entries: readonly DownloadEntry[]): DownloadEntry[][] => [
  ...entries
    .toSorted((a, b) => a.pending.at - b.pending.at)
    .reduce(
      (queues, entry) => queues.set(entry.serverId, [...(queues.get(entry.serverId) ?? []), entry]),
      new Map<string, DownloadEntry[]>(),
    )
    .values(),
]

export const createSync = ({ store, calls, timers, warn }: SyncDeps): Sync => {
  const debouncing = new Map<string, unknown>()
  /** Each download's send while it is out; it settles false when its server could not be reached. */
  const inFlight = new Map<string, Promise<boolean>>()
  /** Downloads touched while their calls were out, which owe another send once the answers land. */
  const touchedDuring = new Set<string>()
  /** Downloads whose 403 or 404 was logged, so a server that keeps answering so is heard of once. */
  const logged = new Set<string>()
  /**
   * Servers whose last call could not reach them. Their downloads' touches wait for the retry
   * instead of sending on every save, until a call the server takes.
   */
  const unreachable = new Set<string>()
  const retry: { timer: unknown } = { timer: undefined }
  let isDisposed = false

  const entryOf = (downloadId: string): DownloadEntry | null =>
    entryById(store.read(), { downloadId })

  /** Sends one call; `taken` when the server took it, so what it carried can be cleared. */
  const deliver = async ({
    entry,
    call,
  }: {
    entry: DownloadEntry
    call: AllowedCall
  }): Promise<Delivery> => {
    const result = await calls.call({ serverId: entry.serverId, call })
    if (!result.ok) {
      unreachable.add(entry.serverId)
      return 'unreachable'
    }
    if (isSuccess(result.status)) {
      unreachable.delete(entry.serverId)
      logged.delete(entry.downloadId)
      return 'taken'
    }
    if (isLogged(result.status) && !logged.has(entry.downloadId)) {
      logged.add(entry.downloadId)
      warn(
        `raven player could not tell its server what was watched of ${loggable(entry.label)}: it answered ${result.status}`,
      )
    }
    return 'refused'
  }

  const warnFailed =
    ({ label }: { label: string | null }) =>
    (error: unknown): void => {
      const what = label === null ? '' : ` of ${loggable(label)}`
      warn(
        `raven player could not tell its server what was watched${what}: ${loggable(errorText(error))}`,
      )
    }

  /** Forgets the logged downloads that are gone, so the set holds only those still held. */
  const pruneLogged = (): void => {
    ;[...logged]
      .filter((downloadId) => entryOf(downloadId) === null)
      .forEach((downloadId) => logged.delete(downloadId))
  }

  /**
   * The furthest position, when it is past the last: the server keeps how far a play got as the
   * most it hears, so it hears this before a scrub back. `taken` when the round may go on.
   */
  const sendFurthest = async (downloadId: string): Promise<Delivery> => {
    const entry = entryOf(downloadId)
    if (entry === null) return 'refused'
    const { furthest, position } = entry.pending
    if (furthest === null || (position !== null && furthest <= position)) return 'taken'
    const delivery = await deliver({
      entry,
      call: { name: 'saveProgress', mediaId: entry.mediaId, position: furthest },
    })
    if (delivery !== 'taken') return delivery
    store.update((state) =>
      clearPending(state, {
        downloadId,
        sentPlay: false,
        sentPosition: null,
        sentFurthest: furthest,
      }),
    )
    return 'taken'
  }

  /**
   * Sends one download's pending; false when its server could not be reached. The play goes
   * first: the server must hear it before a position that may mark the title watched.
   */
  const send = async (downloadId: string): Promise<boolean> => {
    const first = entryOf(downloadId)
    if (first === null || !hasPending(first)) return true
    if (first.pending.play) {
      const played = await deliver({
        entry: first,
        call: { name: 'recordPlay', mediaId: first.mediaId },
      })
      // The play stays pending when the answer was lost, though the server may have taken it:
      // delivery is at least once, so a play can be recorded twice but never none.
      if (played !== 'taken') return played !== 'unreachable'
      store.update((state) =>
        clearPending(state, {
          downloadId,
          sentPlay: true,
          sentPosition: null,
          sentFurthest: null,
        }),
      )
    }
    const reached = await sendFurthest(downloadId)
    if (reached !== 'taken') return reached !== 'unreachable'
    // Read again: the position may have moved while the play or the furthest was out.
    const entry = entryOf(downloadId)
    const position = entry?.pending.position ?? null
    if (entry === null || position === null) return true
    const saved = await deliver({
      entry,
      call: { name: 'saveProgress', mediaId: entry.mediaId, position },
    })
    if (saved !== 'taken') return saved !== 'unreachable'
    // A furthest no further than this position is covered by it.
    store.update((state) =>
      clearPending(state, {
        downloadId,
        sentPlay: false,
        sentPosition: position,
        sentFurthest: position,
      }),
    )
    return true
  }

  const isAnythingPending = (): boolean => store.read().entries.some(hasPending)

  const armRetry = (): void => {
    if (isDisposed || retry.timer !== undefined || !isAnythingPending()) return
    retry.timer = timers.set({
      run: () => {
        retry.timer = undefined
        runAll().catch(warnFailed({ label: null }))
      },
      ms: SYNC_RETRY_MS,
    })
  }

  const debounce = (downloadId: string): void => {
    if (isDisposed || debouncing.has(downloadId)) return
    const entry = entryOf(downloadId)
    // A server that could not be reached hears this download at the retry, not every save.
    if (entry !== null && unreachable.has(entry.serverId)) return
    // A timer already running is left alone, not pushed back: positions arrive every few
    // seconds, and one that kept resetting it would send nothing while a title plays.
    debouncing.set(
      downloadId,
      timers.set({
        run: () => {
          debouncing.delete(downloadId)
          run(downloadId).catch(warnFailed({ label: entryOf(downloadId)?.label ?? null }))
        },
        ms: SYNC_DEBOUNCE_MS,
      }),
    )
  }

  /**
   * Sends one download's pending now; false when its server could not be reached. A download
   * already out is awaited, never sent twice.
   */
  const run = (downloadId: string): Promise<boolean> => {
    const sending = inFlight.get(downloadId)
    if (sending !== undefined) return sending
    const handle = debouncing.get(downloadId)
    if (handle !== undefined) timers.clear(handle)
    debouncing.delete(downloadId)
    const entry = entryOf(downloadId)
    if (entry === null || !hasPending(entry)) return Promise.resolve(true)
    const sent = (async (): Promise<boolean> => {
      const isReached = await send(downloadId).catch((error: unknown) => {
        warnFailed({ label: entry.label })(error)
        return true
      })
      inFlight.delete(downloadId)
      const isOwed = touchedDuring.delete(downloadId)
      const next = entryOf(downloadId)
      if (isOwed && next !== null && hasPending(next)) debounce(downloadId)
      pruneLogged()
      armRetry()
      return isReached
    })()
    inFlight.set(downloadId, sent)
    return sent
  }

  const touch: Sync['touch'] = ({ downloadId }) => {
    if (isDisposed) return
    if (inFlight.has(downloadId)) touchedDuring.add(downloadId)
    else debounce(downloadId)
    armRetry()
  }

  /** Runs one server's downloads one after another; one its server could not reach ends the round. */
  const runInTurn = (queue: readonly DownloadEntry[]): Promise<boolean> =>
    queue.reduce<Promise<boolean>>(
      (previous, { downloadId }) =>
        previous.then((isReached) => (isReached ? run(downloadId) : false)),
      Promise.resolve(true),
    )

  const runFor: Sync['runFor'] = async ({ downloadIds }) => {
    if (isDisposed) return
    pruneLogged()
    const due = downloadIds.flatMap((downloadId) => {
      const entry = entryOf(downloadId)
      return entry !== null && (inFlight.has(downloadId) || hasPending(entry)) ? [entry] : []
    })
    // A download removed while its calls are out is still awaited.
    const leaving = downloadIds.filter(
      (downloadId) => entryOf(downloadId) === null && inFlight.has(downloadId),
    )
    await Promise.all([...leaving.map(run), ...queuesByServer(due).map(runInTurn)])
  }

  const runAll: Sync['runAll'] = () =>
    runFor({ downloadIds: store.read().entries.map(({ downloadId }) => downloadId) })

  const dispose: Sync['dispose'] = () => {
    isDisposed = true
    debouncing.forEach((handle) => timers.clear(handle))
    debouncing.clear()
    if (retry.timer !== undefined) timers.clear(retry.timer)
    retry.timer = undefined
  }

  return { touch, runAll, runFor, dispose }
}

/**
 * Waits for `work`, or `ms` at most, whichever comes first, and never rejects: a deletion that
 * waited on the server goes ahead whatever became of the wait.
 */
export const settleWithin = async ({
  work,
  timers,
  ms,
  warn,
}: {
  work: Promise<void>
  timers: Timers
  ms: number
  warn: (message: string) => void
}): Promise<void> => {
  const waited: { handle: unknown } = { handle: undefined }
  const timedOut = new Promise<void>((resolve) => {
    waited.handle = timers.set({ run: resolve, ms })
  })
  try {
    await Promise.race([work, timedOut])
  } catch (error) {
    warn(
      `raven player could not finish telling its server what was watched: ${loggable(errorText(error))}`,
    )
  } finally {
    timers.clear(waited.handle)
  }
}
