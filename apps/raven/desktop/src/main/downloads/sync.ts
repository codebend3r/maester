import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
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
import { isSuccessStatus } from '@/shared/httpStatuses'

/** A play or a position waits this long before it goes out, so a playing download reports as a stream would. */
export const SYNC_DEBOUNCE_MS = 2000
/** While anything is pending, the server is tried again this often. */
export const SYNC_RETRY_MS = 300_000

type AccountIdOfProps = { serverId: string }

export type SyncDeps = {
  store: DownloadsStore
  calls: Pick<ServerCalls, 'call'>
  timers: Timers
  warn: (message: string) => void
  /** How often the server is tried again; `SYNC_RETRY_MS` unless main's test hook shortens it. */
  retryMs: number
  /** The account signed in to a server, as the page's session names it; null when none is. */
  accountIdOf: (input: AccountIdOfProps) => string | null
}

type TouchProps = { downloadId: string }

type RunForProps = { downloadIds: readonly string[] }

export type Sync = {
  /** A download has something new pending; it goes out once the debounce has run. */
  touch: (input: TouchProps) => void
  /** Sends what every download, and every removed one, has pending now; settles once the answers are in. */
  runAll: () => Promise<void>
  /** Sends what these downloads have pending now; settles once the answers are in. */
  runFor: (input: RunForProps) => Promise<void>
  /**
   * Clears every timer; a send already out finishes and is not followed up. Quitting waits on
   * it through the server calls' `settleWrites`, which settles before the stores flush, and a
   * clear that comes a tick late leaves the store dirty for the quit gate's second flush.
   * Whatever is not cleared is sent at the next launch.
   */
  dispose: () => void
}

/** The statuses that say the server will never take this, or not yet, and are worth a line in the log. */
const isLogged = (status: number): boolean => status === 403 || status === 404

/**
 * How a call went: the server took it, refused it for good or for now (a 403 or a 404),
 * answered something else, or could not be reached; or it never went, since what it carries
 * belongs to an account not signed in to the server now.
 */
const DELIVERIES = {
  taken: 'taken',
  denied: 'denied',
  refused: 'refused',
  unreachable: 'unreachable',
  waiting: 'waiting',
} as const

type Delivery = (typeof DELIVERIES)[keyof typeof DELIVERIES]

/** What a send is for: a download, or what a removed download still owed its server. */
const OWING_KINDS = { entry: 'entry', owed: 'owed' } as const

type Owing =
  | { kind: typeof OWING_KINDS.entry; downloadId: string }
  | { kind: typeof OWING_KINDS.owed; serverId: string; mediaId: number; accountId: string | null }

/** What an owing has pending now, with what its calls need. A removed download has no title. */
type Due = {
  owing: Owing
  serverId: string
  mediaId: number
  label: string | null
  pending: Pending
}

const entryOwing = (downloadId: string): Owing => ({ kind: OWING_KINDS.entry, downloadId })

/** One string per owing, so the maps can key by it: a download id, or its server, media and account. */
const keyOf = (owing: Owing): string => {
  switch (owing.kind) {
    case OWING_KINDS.entry:
      return owing.downloadId
    case OWING_KINDS.owed:
      return JSON.stringify([owing.serverId, owing.mediaId, owing.accountId])
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
  retryMs,
  accountIdOf,
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

  type IsSendableProps = { serverId: string; pending: Pending }

  /**
   * Whether what is pending may go to its server now: what was noted for no account goes to
   * whoever is signed in, and an account's only while that account is.
   */
  const isSendable = ({ serverId, pending }: IsSendableProps): boolean =>
    pending.accountId === null || pending.accountId === accountIdOf({ serverId })

  type DeliverProps = { due: Due; call: AllowedCall }

  /** Sends one call; `taken` when the server took it, so what it carried can be cleared. */
  const deliver = async ({ due, call }: DeliverProps): Promise<Delivery> => {
    // Read again before each call: the account may have signed out while the last was out.
    if (!isSendable(due)) return DELIVERIES.waiting
    const result = await calls.call({
      serverId: due.serverId,
      call,
      accountId: due.pending.accountId,
    })
    // Its account signed out, or another signed in, while the call waited on its token.
    if (!result.ok && !isSendable(due)) return DELIVERIES.waiting
    if (!result.ok) {
      unreachable.add(due.serverId)
      return DELIVERIES.unreachable
    }
    const key = keyOf(due.owing)
    if (isSuccessStatus(result.status)) {
      unreachable.delete(due.serverId)
      logged.delete(key)
      return DELIVERIES.taken
    }
    if (!isLogged(result.status)) return DELIVERIES.refused
    if (!logged.has(key)) {
      logged.set(key, due.owing)
      const what = due.label === null ? 'a deleted download' : loggable(due.label)
      warn(
        `Raven could not tell its server what was watched of ${what}: it answered ${result.status}`,
      )
    }
    return DELIVERIES.denied
  }

  type NotTakenProps = { due: Due; delivery: Delivery }

  /**
   * What a call that was not taken leaves: a download keeps its pending for the next round (a
   * relocked library hears it after the unlock), and an owed item the server denies goes, since
   * no later download will ever clear it. False when the server could not be reached.
   */
  const notTaken = ({ due, delivery }: NotTakenProps): boolean => {
    const { owing } = due
    if (delivery === DELIVERIES.denied && owing.kind === OWING_KINDS.owed) {
      store.update((state) => dropOwed(state, owing))
    }
    return delivery !== DELIVERIES.unreachable
  }

  type ClearSentProps = {
    due: Due
    sentPlay: boolean
    sentPosition: number | null
    sentFurthest: number | null
  }

  /**
   * Clears what the server took. A download removed while its call was out, or whose account
   * signed out meanwhile, has moved its pending to `owed`, so it is cleared there, never sent
   * twice, and what the download now holds for another account is left alone.
   */
  const clearSent = ({ due, sentPlay, sentPosition, sentFurthest }: ClearSentProps): void => {
    const sent = { sentPlay, sentPosition, sentFurthest }
    const { owing, serverId, mediaId } = due
    const { accountId } = due.pending
    store.update((state) => {
      const entry = owing.kind === OWING_KINDS.entry ? entryById(state, owing) : null
      return entry !== null && entry.pending.accountId === accountId
        ? clearPending(state, { downloadId: entry.downloadId, ...sent })
        : clearOwed(state, { serverId, mediaId, accountId, ...sent })
    })
  }

  type WarnFailedProps = { label: string | null }

  const warnFailed =
    ({ label }: WarnFailedProps) =>
    (error: unknown): void => {
      const what = label === null ? '' : ` of ${loggable(label)}`
      warn(`Raven could not tell its server what was watched${what}: ${loggable(errorText(error))}`)
    }

  /** Forgets the logged owings that are gone, so the map holds only those still held. */
  const pruneLogged = (): void => {
    ;[...logged].filter(([, owing]) => dueOf(owing) === null).forEach(([key]) => logged.delete(key))
  }

  /**
   * The furthest position, when it is past the last: the server keeps how far a play got as the
   * most it hears, so it hears this before a scrub back. `taken` when the round may go on.
   */
  const sendFurthest = async (due: Due | null): Promise<Delivery> => {
    if (due === null) return DELIVERIES.refused
    const { furthest, position } = due.pending
    if (furthest === null || (position !== null && furthest <= position)) return DELIVERIES.taken
    const delivery = await deliver({
      due,
      call: {
        name: CALL_NAMES.saveProgress,
        mediaId: due.mediaId,
        position: furthest,
        audio: null,
      },
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
    const { accountId } = first.pending
    /** What the download holds now, unless it now belongs to another account: the next round's. */
    const dueAsFirst = (): Due | null => {
      const due = dueOf(owing)
      return due !== null && due.pending.accountId === accountId ? due : null
    }
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
    const reached = await sendFurthest(dueAsFirst())
    if (reached !== DELIVERIES.taken) return reached !== DELIVERIES.unreachable
    // Read again: the position may have moved while the play or the furthest was out.
    const due = dueAsFirst()
    const position = due?.pending.position ?? null
    if (due === null || position === null) return true
    const saved = await deliver({
      due,
      call: { name: CALL_NAMES.saveProgress, mediaId: due.mediaId, position, audio: null },
    })
    if (saved !== DELIVERIES.taken) return notTaken({ due, delivery: saved })
    // A furthest no further than this position is covered by it.
    clearSent({ due, sentPlay: false, sentPosition: position, sentFurthest: position })
    return true
  }

  type IsSendableNowProps = { serverId: string; pending: Pending }

  const isSendableNow = (item: IsSendableNowProps): boolean => hasPending(item) && isSendable(item)

  /** Whether anything could go now; what waits on an account goes when that account signs in. */
  const isAnythingPending = (): boolean => {
    const { entries, owed } = store.read()
    return entries.some(isSendableNow) || owed.some(isSendableNow)
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
    if (due === null || !isSendableNow(due)) return Promise.resolve(true)
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
      return due !== null && (inFlight.has(keyOf(owing)) || isSendableNow(due)) ? [due] : []
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
      ...owed.map(({ serverId, mediaId, pending }): Owing => ({
        kind: OWING_KINDS.owed,
        serverId,
        mediaId,
        accountId: pending.accountId,
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

type SettleWithinProps = {
  work: Promise<void>
  timers: Timers
  ms: number
  warn: (message: string) => void
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
}: SettleWithinProps): Promise<void> => {
  const bounded = await within({ task: work, ms, timers })
  if (bounded.outcome !== BOUNDED_OUTCOMES.failed) return
  warn(
    `Raven could not finish telling its server what was watched: ${loggable(errorText(bounded.error))}`,
  )
}
