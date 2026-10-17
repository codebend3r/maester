import {
  clearOwed,
  clearPending,
  dropOwed,
  entryById,
  hasPending,
  owedOf,
  type DownloadsState,
  type Pending,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { errorText } from '@/main/log/errorText'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
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
  /** How often the server is tried again; `SYNC_RETRY_MS` unless main's test hook shortens it. */
  retryMs?: number
}

export type Sync = {
  /** A download has something new pending; it goes out once the debounce has run. */
  touch: (input: { downloadId: string }) => void
  /** Sends what every download, and every removed one, has pending now; settles once the answers are in. */
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

const isSuccess = (status: number): boolean => status >= 200 && status < 300

/** The statuses that say the server will never take this, or not yet, and are worth a line in the log. */
const isLogged = (status: number): boolean => status === 403 || status === 404

/**
 * How a call went: the server took it, refused it for good or for now (a 403 or a 404),
 * answered something else, or could not be reached.
 */
const DELIVERIES = {
  taken: 'taken',
  denied: 'denied',
  refused: 'refused',
  unreachable: 'unreachable',
} as const

type Delivery = (typeof DELIVERIES)[keyof typeof DELIVERIES]

/** What a send is for: a download, or what a removed download still owed its server. */
const OWING_KINDS = { entry: 'entry', owed: 'owed' } as const

type Owing =
  | { kind: typeof OWING_KINDS.entry; downloadId: string }
  | { kind: typeof OWING_KINDS.owed; serverId: string; mediaId: number }

/** What an owing has pending now, with what its calls need. A removed download has no title. */
type Due = {
  owing: Owing
  serverId: string
  mediaId: number
  label: string | null
  pending: Pending
}

const entryOwing = (downloadId: string): Owing => ({ kind: OWING_KINDS.entry, downloadId })

/** One string per owing, so the maps can key by it: a download id, or its server and media. */
const keyOf = (owing: Owing): string => {
  switch (owing.kind) {
    case OWING_KINDS.entry:
      return owing.downloadId
    case OWING_KINDS.owed:
      return JSON.stringify([owing.serverId, owing.mediaId])
    default: {
      const unreachable: never = owing
      return unreachable
    }
  }
}

const dueIn = (state: DownloadsState, owing: Owing): Due | null => {
  switch (owing.kind) {
    case OWING_KINDS.entry: {
      const entry = entryById(state, owing)
      if (entry === null) return null
      const { serverId, mediaId, label, pending } = entry
      return { owing, serverId, mediaId, label, pending }
    }
    case OWING_KINDS.owed: {
      const owed = owedOf(state, owing)
      if (owed === null) return null
      return {
        owing,
        serverId: owed.serverId,
        mediaId: owed.mediaId,
        label: null,
        pending: owed.pending,
      }
    }
    default: {
      const unreachable: never = owing
      return unreachable
    }
  }
}

/**
 * Each server's due downloads and owed items, oldest pending first: a server hears them one at
 * a time in the order they were made, so each report replaces the one before as it did when made.
 */
const queuesByServer = (dues: readonly Due[]): Due[][] => [
  ...dues
    .toSorted((a, b) => a.pending.at - b.pending.at)
    .reduce(
      (queues, due) => queues.set(due.serverId, [...(queues.get(due.serverId) ?? []), due]),
      new Map<string, Due[]>(),
    )
    .values(),
]

export const createSync = ({
  store,
  calls,
  timers,
  warn,
  retryMs = SYNC_RETRY_MS,
}: SyncDeps): Sync => {
  const debouncing = new Map<string, unknown>()
  /** Each send while it is out, by `keyOf`; it settles false when its server could not be reached. */
  const inFlight = new Map<string, Promise<boolean>>()
  /** Downloads touched while their calls were out, which owe another send once the answers land. */
  const touchedDuring = new Set<string>()
  /** Owings whose 403 or 404 was logged, by `keyOf`, so a server that keeps answering so is heard of once. */
  const logged = new Map<string, Owing>()
  /**
   * Servers whose last call could not reach them. Their downloads' touches wait for the retry
   * instead of sending on every save, until a call the server takes.
   */
  const unreachable = new Set<string>()
  const retry: { timer: unknown } = { timer: undefined }
  let isDisposed = false

  const dueOf = (owing: Owing): Due | null => dueIn(store.read(), owing)

  /** Sends one call; `taken` when the server took it, so what it carried can be cleared. */
  const deliver = async ({ due, call }: { due: Due; call: AllowedCall }): Promise<Delivery> => {
    const result = await calls.call({ serverId: due.serverId, call })
    if (!result.ok) {
      unreachable.add(due.serverId)
      return DELIVERIES.unreachable
    }
    const key = keyOf(due.owing)
    if (isSuccess(result.status)) {
      unreachable.delete(due.serverId)
      logged.delete(key)
      return DELIVERIES.taken
    }
    if (!isLogged(result.status)) return DELIVERIES.refused
    if (!logged.has(key)) {
      logged.set(key, due.owing)
      const what = due.label === null ? 'a deleted download' : loggable(due.label)
      warn(
        `raven player could not tell its server what was watched of ${what}: it answered ${result.status}`,
      )
    }
    return DELIVERIES.denied
  }

  /**
   * What a call that was not taken leaves: a download keeps its pending for the next round (a
   * relocked library hears it after the unlock), and an owed item the server denies goes, since
   * no later download will ever clear it. False when the server could not be reached.
   */
  const notTaken = ({ due, delivery }: { due: Due; delivery: Delivery }): boolean => {
    const { owing } = due
    if (delivery === DELIVERIES.denied && owing.kind === OWING_KINDS.owed) {
      store.update((state) => dropOwed(state, owing))
    }
    return delivery !== DELIVERIES.unreachable
  }

  /**
   * Clears what the server took. A download removed while its call was out has moved its
   * pending to `owed`, so it is cleared there, and never sent twice.
   */
  const clearSent = ({
    due,
    sentPlay,
    sentPosition,
    sentFurthest,
  }: {
    due: Due
    sentPlay: boolean
    sentPosition: number | null
    sentFurthest: number | null
  }): void => {
    const sent = { sentPlay, sentPosition, sentFurthest }
    const { owing, serverId, mediaId } = due
    store.update((state) =>
      owing.kind === OWING_KINDS.entry && entryById(state, owing) !== null
        ? clearPending(state, { downloadId: owing.downloadId, ...sent })
        : clearOwed(state, { serverId, mediaId, ...sent }),
    )
  }

  const warnFailed =
    ({ label }: { label: string | null }) =>
    (error: unknown): void => {
      const what = label === null ? '' : ` of ${loggable(label)}`
      warn(
        `raven player could not tell its server what was watched${what}: ${loggable(errorText(error))}`,
      )
    }

  /** Forgets the logged owings that are gone, so the map holds only those still held. */
  const pruneLogged = (): void => {
    ;[...logged].filter(([, owing]) => dueOf(owing) === null).forEach(([key]) => logged.delete(key))
  }

  /**
   * The furthest position, when it is past the last: the server keeps how far a play got as the
   * most it hears, so it hears this before a scrub back. `taken` when the round may go on.
   */
  const sendFurthest = async (owing: Owing): Promise<Delivery> => {
    const due = dueOf(owing)
    if (due === null) return DELIVERIES.refused
    const { furthest, position } = due.pending
    if (furthest === null || (position !== null && furthest <= position)) return DELIVERIES.taken
    const delivery = await deliver({
      due,
      call: { name: CALL_NAMES.saveProgress, mediaId: due.mediaId, position: furthest },
    })
    if (delivery !== DELIVERIES.taken)
      return notTaken({ due, delivery }) ? DELIVERIES.refused : DELIVERIES.unreachable
    clearSent({ due, sentPlay: false, sentPosition: null, sentFurthest: furthest })
    return DELIVERIES.taken
  }

  /**
   * Sends one owing's pending; false when its server could not be reached. The play goes
   * first: the server must hear it before a position that may mark the title watched.
   */
  const send = async (owing: Owing): Promise<boolean> => {
    const first = dueOf(owing)
    if (first === null || !hasPending(first)) return true
    if (first.pending.play) {
      const played = await deliver({
        due: first,
        call: { name: CALL_NAMES.recordPlay, mediaId: first.mediaId },
      })
      // The play stays pending when the answer was lost, though the server may have taken it:
      // delivery is at least once, so a play can be recorded twice but never none.
      if (played !== DELIVERIES.taken) return notTaken({ due: first, delivery: played })
      clearSent({ due: first, sentPlay: true, sentPosition: null, sentFurthest: null })
    }
    const reached = await sendFurthest(owing)
    if (reached !== DELIVERIES.taken) return reached !== DELIVERIES.unreachable
    // Read again: the position may have moved while the play or the furthest was out.
    const due = dueOf(owing)
    const position = due?.pending.position ?? null
    if (due === null || position === null) return true
    const saved = await deliver({
      due,
      call: { name: CALL_NAMES.saveProgress, mediaId: due.mediaId, position },
    })
    if (saved !== DELIVERIES.taken) return notTaken({ due, delivery: saved })
    // A furthest no further than this position is covered by it.
    clearSent({ due, sentPlay: false, sentPosition: position, sentFurthest: position })
    return true
  }

  const isAnythingPending = (): boolean => {
    const { entries, owed } = store.read()
    return entries.some(hasPending) || owed.some(hasPending)
  }

  const armRetry = (): void => {
    if (isDisposed || retry.timer !== undefined || !isAnythingPending()) return
    retry.timer = timers.set({
      run: () => {
        retry.timer = undefined
        runAll().catch(warnFailed({ label: null }))
      },
      ms: retryMs,
    })
  }

  const debounce = (downloadId: string): void => {
    if (isDisposed || debouncing.has(downloadId)) return
    const entry = entryById(store.read(), { downloadId })
    // A server that could not be reached hears this download at the retry, not every save.
    if (entry !== null && unreachable.has(entry.serverId)) return
    // A timer already running is left alone, not pushed back: positions arrive every few
    // seconds, and one that kept resetting it would send nothing while a title plays.
    debouncing.set(
      downloadId,
      timers.set({
        run: () => {
          debouncing.delete(downloadId)
          const owing = entryOwing(downloadId)
          run(owing).catch(warnFailed({ label: dueOf(owing)?.label ?? null }))
        },
        ms: SYNC_DEBOUNCE_MS,
      }),
    )
  }

  /**
   * Sends one owing's pending now; false when its server could not be reached. One already out
   * is awaited, never sent twice.
   */
  const run = (owing: Owing): Promise<boolean> => {
    const key = keyOf(owing)
    const sending = inFlight.get(key)
    if (sending !== undefined) return sending
    const handle = debouncing.get(key)
    if (handle !== undefined) timers.clear(handle)
    debouncing.delete(key)
    const due = dueOf(owing)
    if (due === null || !hasPending(due)) return Promise.resolve(true)
    const sent = (async (): Promise<boolean> => {
      const isReached = await send(owing).catch((error: unknown) => {
        warnFailed({ label: due.label })(error)
        return true
      })
      inFlight.delete(key)
      const isTouched = touchedDuring.delete(key)
      const next = dueOf(owing)
      if (isTouched && owing.kind === OWING_KINDS.entry && next !== null && hasPending(next)) {
        debounce(owing.downloadId)
      }
      pruneLogged()
      armRetry()
      return isReached
    })()
    inFlight.set(key, sent)
    return sent
  }

  const touch: Sync['touch'] = ({ downloadId }) => {
    if (isDisposed) return
    if (inFlight.has(downloadId)) touchedDuring.add(downloadId)
    else debounce(downloadId)
    armRetry()
  }

  /**
   * Runs one server's owings one after another; one its server could not reach ends the round,
   * and so does `dispose`, which lets the send already out finish but starts no other.
   */
  const runInTurn = (queue: readonly Due[]): Promise<boolean> =>
    queue.reduce<Promise<boolean>>(
      (previous, { owing }) =>
        previous.then((isReached) => (isReached && !isDisposed ? run(owing) : false)),
      Promise.resolve(true),
    )

  /** Runs these owings, each server's in turn; one already out is awaited however it stands now. */
  const runEach = async (owings: readonly Owing[]): Promise<void> => {
    if (isDisposed) return
    pruneLogged()
    const dues = owings.flatMap((owing) => {
      const due = dueOf(owing)
      return due !== null && (inFlight.has(keyOf(owing)) || hasPending(due)) ? [due] : []
    })
    // A download removed while its calls are out is still awaited.
    const leaving = owings.filter((owing) => dueOf(owing) === null && inFlight.has(keyOf(owing)))
    await Promise.all([...leaving.map(run), ...queuesByServer(dues).map(runInTurn)])
  }

  const runFor: Sync['runFor'] = ({ downloadIds }) => runEach(downloadIds.map(entryOwing))

  const runAll: Sync['runAll'] = () => {
    const { entries, owed } = store.read()
    return runEach([
      ...entries.map(({ downloadId }) => entryOwing(downloadId)),
      ...owed.map(({ serverId, mediaId }): Owing => ({
        kind: OWING_KINDS.owed,
        serverId,
        mediaId,
      })),
    ])
  }

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
