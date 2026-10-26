import {
  DOWNLOAD_STATUS_KINDS,
  type Infer,
  isBoolean,
  isContainerName,
  isDownloadGroup,
  isMediaId,
  isNumber,
  isOpaqueId,
  isSidecarTrackId,
  isString,
  isWatchedPercent,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@raven/core'

export const DOWNLOADS_FILE = 'downloads.json'

/** A subtitle file kept beside the video: `trackId` is the server's `external-<n>`. */
const isSidecar = object({ trackId: isSidecarTrackId, title: isString, language: isString })

/** A file's size as the server gives it: a whole number of bytes above 0, or nothing to fetch. */
export const isFileSize = (value: unknown): value is number =>
  isNumber(value) && Number.isSafeInteger(value) && value > 0

const PENDING_FIELDS = {
  play: isBoolean,
  position: nullable(isNumber),
  furthest: nullable(isNumber),
  at: isNumber,
}

/** What version 1 kept pending, before a play belonged to an account. */
const isPendingV1 = object(PENDING_FIELDS)

/**
 * What the server has not heard yet: a play to record, the last position to report, and the
 * furthest position since the last send. The server keeps how far a play got as the most it
 * hears, so a scrub back after the end must not be all it hears. `accountId` is the account
 * signed in to the server when it was noted, sent only under that account; null for what was
 * noted before plays belonged to an account, which goes to whoever is signed in.
 */
const isPending = object({ ...PENDING_FIELDS, accountId: nullable(isString) })

/** Why a download waits paused: the viewer paused it, or the queue did for the disk, a relock or an outage. */
export const PAUSE_REASONS = {
  viewer: 'viewer',
  noSpace: 'noSpace',
  relocked: 'relocked',
  unreachable: 'unreachable',
} as const

const isPauseReason = oneOf(Object.values(PAUSE_REASONS))

/** Why a download failed. Only `other` has words of its own, kept in the status's `message`. */
export const FAIL_REASONS = {
  noSpace: 'noSpace',
  changed: 'changed',
  unauthorized: 'unauthorized',
  unreachable: 'unreachable',
  gone: 'gone',
  other: 'other',
} as const

const isFailReason = oneOf(Object.values(FAIL_REASONS))

/**
 * A download's status as `downloads.json` keeps it: why it stopped is a reason, and the page's
 * words are built from it when the page reads it, so renaming a server changes no reason.
 */
const isEntryStatus = union(
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.queued]) }),
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.downloading]), bytes: isNumber }),
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.paused]), bytes: isNumber, reason: isPauseReason }),
  object({
    kind: oneOf([DOWNLOAD_STATUS_KINDS.failed]),
    bytes: isNumber,
    reason: isFailReason,
    message: isString,
  }),
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.ready]) }),
)

const ENTRY_FIELDS = {
  downloadId: isOpaqueId,
  serverId: isOpaqueId,
  mediaId: isMediaId,
  label: isString,
  group: isDownloadGroup,
  container: isContainerName,
  size: isFileSize,
  duration: nullable(isNumber),
  watchedPercent: isWatchedPercent,
  sidecars: listOf(isSidecar),
  status: isEntryStatus,
  autoDelete: isBoolean,
  watchedAt: nullable(isNumber),
  /**
   * Where the server had playback when the download was confirmed, so a title streamed partway
   * opens there; 0 once a position is noted here, after which the local resume spot decides.
   */
  serverPosition: isNumber,
  createdAt: isNumber,
}

export const isDownloadEntry = object({ ...ENTRY_FIELDS, pending: isPending })

/**
 * What a removed download still owed its server, kept until the server hears it: removing a
 * download offline, as its auto-delete does, must not lose what was watched. What an account
 * watched waits here too once another signs in. One item per title and account.
 */
const OWED_FIELDS = { serverId: isOpaqueId, mediaId: isMediaId }

const isOwed = object({ ...OWED_FIELDS, pending: isPending })

export const isDownloadsState = object({
  version: oneOf([2]),
  entries: listOf(isDownloadEntry),
  autoDeleteDefault: isBoolean,
  owed: listOf(isOwed),
})

/** What `downloads.json` may hold: this version, or the one before plays belonged to an account. */
export const isStoredDownloads = union(
  object({
    version: oneOf([1]),
    entries: listOf(object({ ...ENTRY_FIELDS, pending: isPendingV1 })),
    autoDeleteDefault: isBoolean,
    owed: listOf(object({ ...OWED_FIELDS, pending: isPendingV1 })),
  }),
  isDownloadsState,
)

export type PauseReason = Infer<typeof isPauseReason>
export type FailReason = Infer<typeof isFailReason>
export type EntryStatus = Infer<typeof isEntryStatus>
export type Sidecar = Infer<typeof isSidecar>
export type Pending = Infer<typeof isPending>
export type DownloadEntry = Infer<typeof isDownloadEntry>
export type Owed = Infer<typeof isOwed>
export type DownloadsState = Infer<typeof isDownloadsState>

export const EMPTY_DOWNLOADS: DownloadsState = {
  version: 2,
  entries: [],
  autoDeleteDefault: false,
  owed: [],
}

export const NO_PENDING: Pending = {
  play: false,
  position: null,
  furthest: null,
  at: 0,
  accountId: null,
}

/** Version 1 noted no account, so what it kept pending goes to whoever is signed in, as it did. */
const sharedPending = ({ play, position, furthest, at }: Infer<typeof isPendingV1>): Pending => ({
  play,
  position,
  furthest,
  at,
  accountId: null,
})

export const upgradeDownloads = (stored: Infer<typeof isStoredDownloads>): DownloadsState => {
  switch (stored.version) {
    case 1:
      return {
        version: 2,
        entries: stored.entries.map((entry) => ({
          ...entry,
          pending: sharedPending(entry.pending),
        })),
        autoDeleteDefault: stored.autoDeleteDefault,
        owed: stored.owed.map((item) => ({ ...item, pending: sharedPending(item.pending) })),
      }
    case 2:
      return stored
    default: {
      const unreachable: never = stored
      return unreachable
    }
  }
}

type EntryByIdProps = { downloadId: string }

export const entryById = (
  state: DownloadsState,
  { downloadId }: EntryByIdProps,
): DownloadEntry | null => state.entries.find((entry) => entry.downloadId === downloadId) ?? null

type EntryByMediaProps = { serverId: string; mediaId: number }

export const entryByMedia = (
  state: DownloadsState,
  { serverId, mediaId }: EntryByMediaProps,
): DownloadEntry | null =>
  state.entries.find((entry) => entry.serverId === serverId && entry.mediaId === mediaId) ?? null

/** What is on disk: the whole size when ready, else what the status says it has. */
export const bytesOf = (entry: DownloadEntry): number => {
  const { status } = entry
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.queued:
      return 0
    case DOWNLOAD_STATUS_KINDS.ready:
      return entry.size
    case DOWNLOAD_STATUS_KINDS.downloading:
    case DOWNLOAD_STATUS_KINDS.paused:
    case DOWNLOAD_STATUS_KINDS.failed:
      return status.bytes
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

type ChangeEntryProps = { downloadId: string; change: (entry: DownloadEntry) => DownloadEntry }

/**
 * Applies `change` to one entry. An unknown id, or a `change` that hands the entry back,
 * returns `state` itself, so `JsonStore.update` sees no change and writes nothing.
 */
const changeEntry = (
  state: DownloadsState,
  { downloadId, change }: ChangeEntryProps,
): DownloadsState => {
  const current = entryById(state, { downloadId })
  if (!current) return state
  const next = change(current)
  if (next === current) return state
  return {
    ...state,
    entries: state.entries.map((entry) => (entry === current ? next : entry)),
  }
}

type WithStatusProps = { status: EntryStatus }

const withStatus = (entry: DownloadEntry, { status }: WithStatusProps): DownloadEntry => ({
  ...entry,
  status,
})

type QueueProps = { entries: readonly DownloadEntry[] }

export const queue = (state: DownloadsState, { entries }: QueueProps): DownloadsState => {
  const added = entries.reduce<DownloadEntry[]>((kept, entry) => {
    const isKnown = [...state.entries, ...kept].some(
      (known) => known.serverId === entry.serverId && known.mediaId === entry.mediaId,
    )
    return isKnown ? kept : [...kept, entry]
  }, [])
  if (added.length === 0) return state
  return { ...state, entries: [...state.entries, ...added] }
}

type StartProps = { downloadId: string }

/**
 * Only a queued file starts: a run begins for one, and a pause or a failure that came while it
 * read its ticket must stand.
 */
export const start = (state: DownloadsState, { downloadId }: StartProps): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      switch (entry.status.kind) {
        case DOWNLOAD_STATUS_KINDS.queued:
          return withStatus(entry, {
            status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 },
          })
        case DOWNLOAD_STATUS_KINDS.paused:
        case DOWNLOAD_STATUS_KINDS.failed:
        case DOWNLOAD_STATUS_KINDS.downloading:
        case DOWNLOAD_STATUS_KINDS.ready:
          return entry
        default: {
          const unreachable: never = entry.status
          return unreachable
        }
      }
    },
  })

type AdvanceProps = { downloadId: string; bytes: number }

export const advance = (
  state: DownloadsState,
  { downloadId, bytes }: AdvanceProps,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.downloading && entry.status.bytes !== bytes
        ? withStatus(entry, { status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes } })
        : entry,
  })

const isPausable = (entry: DownloadEntry): boolean =>
  entry.status.kind === DOWNLOAD_STATUS_KINDS.queued ||
  entry.status.kind === DOWNLOAD_STATUS_KINDS.downloading

type PausedProps = { reason: PauseReason }

const paused = (entry: DownloadEntry, { reason }: PausedProps): DownloadEntry =>
  isPausable(entry)
    ? withStatus(entry, {
        status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: bytesOf(entry), reason },
      })
    : entry

type PauseProps = { downloadId: string; reason: PauseReason }

export const pause = (state: DownloadsState, { downloadId, reason }: PauseProps): DownloadsState =>
  changeEntry(state, { downloadId, change: (entry) => paused(entry, { reason }) })

type PauseServerProps = { serverId: string; reason: PauseReason }

export const pauseServer = (
  state: DownloadsState,
  { serverId, reason }: PauseServerProps,
): DownloadsState => {
  const isTouched = (entry: DownloadEntry): boolean =>
    entry.serverId === serverId && isPausable(entry)
  if (!state.entries.some(isTouched)) return state
  return {
    ...state,
    entries: state.entries.map((entry) => (isTouched(entry) ? paused(entry, { reason }) : entry)),
  }
}

/** Whether a file waits on an outage, which the queue tries again on its own. */
export const isWaitingOnOutage = ({ status }: DownloadEntry): boolean =>
  (status.kind === DOWNLOAD_STATUS_KINDS.paused && status.reason === PAUSE_REASONS.unreachable) ||
  (status.kind === DOWNLOAD_STATUS_KINDS.failed && status.reason === FAIL_REASONS.unreachable)

/**
 * The viewer's Pause all: what runs or waits pauses, and so does what waits on an outage, or
 * the outage retry would start it again. A relocked file keeps its reason, so it still unlocks.
 */
export const pauseEverything = (state: DownloadsState): DownloadsState => {
  const isTouched = (entry: DownloadEntry): boolean => isPausable(entry) || isWaitingOnOutage(entry)
  if (!state.entries.some(isTouched)) return state
  return {
    ...state,
    entries: state.entries.map((entry) =>
      isTouched(entry)
        ? withStatus(entry, {
            status: {
              kind: DOWNLOAD_STATUS_KINDS.paused,
              bytes: bytesOf(entry),
              reason: PAUSE_REASONS.viewer,
            },
          })
        : entry,
    ),
  }
}

type ResumeProps = { downloadId: string }

export const resume = (state: DownloadsState, { downloadId }: ResumeProps): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.paused ||
      entry.status.kind === DOWNLOAD_STATUS_KINDS.failed
        ? withStatus(entry, { status: { kind: DOWNLOAD_STATUS_KINDS.queued } })
        : entry,
  })

type FailProps = { downloadId: string; reason: FailReason; message?: string }

/** `message` is the words of an `other` failure; every other reason says it all and keeps none. */
export const fail = (
  state: DownloadsState,
  { downloadId, reason, message = '' }: FailProps,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.ready
        ? entry
        : withStatus(entry, {
            status: { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: bytesOf(entry), reason, message },
          }),
  })

type FinishProps = { downloadId: string }

export const finish = (state: DownloadsState, { downloadId }: FinishProps): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.ready
        ? entry
        : withStatus(entry, { status: { kind: DOWNLOAD_STATUS_KINDS.ready } }),
  })

type HasPendingProps = { pending: Pending }

/** Whether the server has yet to hear something of this download or owed item. */
export const hasPending = ({ pending }: HasPendingProps): boolean =>
  pending.play || pending.position !== null || pending.furthest !== null

/** What one round of a sync sent: the play, if it went, and the positions it carried. */
type Sent = { sentPlay: boolean; sentPosition: number | null; sentFurthest: number | null }

/** `pending` less what a sync sent; the same object when the send cleared nothing. */
const clearedOf = (pending: Pending, { sentPlay, sentPosition, sentFurthest }: Sent): Pending => {
  const position = pending.position === sentPosition ? null : pending.position
  const furthest = pending.furthest === sentFurthest ? null : pending.furthest
  const play = sentPlay ? false : pending.play
  if (play === pending.play && position === pending.position && furthest === pending.furthest) {
    return pending
  }
  return { ...pending, play, position, furthest }
}

/** One owed item: a title of a server, under the account its play and positions belong to. */
type OwedKey = { serverId: string; mediaId: number; accountId: string | null }

const isOwedAs =
  ({ serverId, mediaId, accountId }: OwedKey) =>
  (item: Owed): boolean =>
    item.serverId === serverId && item.mediaId === mediaId && item.pending.accountId === accountId

export const owedOf = (state: DownloadsState, key: OwedKey): Owed | null =>
  state.owed.find(isOwedAs(key)) ?? null

/** The higher of two positions, either of which may be none. */
const furthestOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : Math.max(a, b ?? a)

type MergePendingProps = { a: Pending; b: Pending }

/**
 * Two pending records of one title as one: a play either owes, the newer last position, and the
 * furthest of both (never below that position), as `notePending` folds a report into what is
 * pending.
 */
const mergePending = ({ a, b }: MergePendingProps): Pending => {
  const [older, newer] = a.at <= b.at ? [a, b] : [b, a]
  const position = newer.position ?? older.position
  const furthest = furthestOf(a.furthest, b.furthest)
  return {
    play: a.play || b.play,
    position,
    furthest: position === null || furthest === null ? furthest : Math.max(furthest, position),
    at: newer.at,
    accountId: newer.accountId,
  }
}

type OweProps = { entries: readonly DownloadEntry[] }

/**
 * `owed` with what these entries still owe their servers folded in, one item per title and
 * account: what one account watched never folds into another's.
 */
const owe = (state: DownloadsState, { entries }: OweProps): Owed[] =>
  entries.filter(hasPending).reduce<Owed[]>((owed, { serverId, mediaId, pending }) => {
    const known = owed.find(isOwedAs({ serverId, mediaId, accountId: pending.accountId }))
    if (known === undefined) return [...owed, { serverId, mediaId, pending }]
    const merged = { ...known, pending: mergePending({ a: known.pending, b: pending }) }
    return owed.map((item) => (item === known ? merged : item))
  }, state.owed)

type OweOtherAccountsProps = { serverId: string; accountId: string | null }

/**
 * The account signed in to a server changed: what its downloads hold pending for any other
 * account moves to `owed` under that account, where it waits until that account signs in to the
 * server again. What was noted for no account stays, for whoever is signed in.
 */
export const oweOtherAccounts = (
  state: DownloadsState,
  { serverId, accountId }: OweOtherAccountsProps,
): DownloadsState => {
  const isOwing = (entry: DownloadEntry): boolean =>
    entry.serverId === serverId &&
    hasPending(entry) &&
    entry.pending.accountId !== null &&
    entry.pending.accountId !== accountId
  const owing = state.entries.filter(isOwing)
  if (owing.length === 0) return state
  return {
    ...state,
    entries: state.entries.map((entry) =>
      isOwing(entry) ? { ...entry, pending: NO_PENDING } : entry,
    ),
    owed: owe(state, { entries: owing }),
  }
}

type RemoveProps = { downloadId: string }

/** Drops one entry; what the server has not heard of it moves to `owed` in the same change. */
export const remove = (state: DownloadsState, { downloadId }: RemoveProps): DownloadsState => {
  const removed = entryById(state, { downloadId })
  if (removed === null) return state
  return {
    ...state,
    entries: state.entries.filter((entry) => entry !== removed),
    owed: owe(state, { entries: [removed] }),
  }
}

/** Drops every entry; what the servers have not heard of them moves to `owed`. */
export const removeAll = (state: DownloadsState): DownloadsState =>
  state.entries.length === 0
    ? state
    : { ...state, entries: [], owed: owe(state, { entries: state.entries }) }

type IsSameListProps<T> = { left: readonly T[]; right: readonly T[] }

const isSameList = <T>({ left, right }: IsSameListProps<T>): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index])

type KeepOneServerProps = {
  state: DownloadsState
  serverId: string
  adopted: readonly string[]
  moved: ReadonlySet<string>
}

/**
 * Files every download under the one server Raven plays from. The downloads in `moved`,
 * an adopted server's whose folders now sit under the server's id, become the server's, and what
 * an adopted server was owed, or its downloads that did not move still owe, is the server's too.
 * A download of any other server is no longer reached: a ready one stays to play, owing that
 * server nothing, and the rest go, as does what that server was owed. Nothing to change, as at
 * every launch after the first, hands back the same state.
 */
export const keepOneServer = ({
  state,
  serverId,
  adopted,
  moved,
}: KeepOneServerProps): DownloadsState => {
  const entries = state.entries.flatMap((entry): DownloadEntry[] => {
    if (entry.serverId === serverId) return [entry]
    if (moved.has(entry.downloadId)) return [{ ...entry, serverId }]
    if (entry.status.kind !== DOWNLOAD_STATUS_KINDS.ready) return []
    return [hasPending(entry) ? { ...entry, pending: NO_PENDING } : entry]
  })
  // An adopted server's download that stayed where it was (a twin of a title the server has, or a
  // folder that could not move) still owes what was watched of it, now to the server.
  const unmoved = state.entries
    .filter(
      (entry) =>
        entry.serverId !== serverId &&
        adopted.includes(entry.serverId) &&
        !moved.has(entry.downloadId),
    )
    .map((entry) => ({ ...entry, serverId }))
  const carried = state.owed.reduce<Owed[]>((kept, item) => {
    if (item.serverId !== serverId && !adopted.includes(item.serverId)) return kept
    const filed = item.serverId === serverId ? item : { ...item, serverId }
    const known = kept.find(
      isOwedAs({ serverId, mediaId: filed.mediaId, accountId: filed.pending.accountId }),
    )
    if (known === undefined) return [...kept, filed]
    const merged = { ...known, pending: mergePending({ a: known.pending, b: filed.pending }) }
    return kept.map((each) => (each === known ? merged : each))
  }, [])
  const owed = owe({ ...state, owed: carried }, { entries: unmoved })
  return isSameList({ left: entries, right: state.entries }) &&
    isSameList({ left: owed, right: state.owed })
    ? state
    : { ...state, entries, owed }
}

/** What the server took is no longer owed; an item it took all of goes. */
export const clearOwed = (
  state: DownloadsState,
  { serverId, mediaId, accountId, sentPlay, sentPosition, sentFurthest }: OwedKey & Sent,
): DownloadsState => {
  const current = owedOf(state, { serverId, mediaId, accountId })
  if (current === null) return state
  const pending = clearedOf(current.pending, { sentPlay, sentPosition, sentFurthest })
  if (pending === current.pending) return state
  const owed = hasPending({ pending })
    ? state.owed.map((item) => (item === current ? { ...item, pending } : item))
    : state.owed.filter((item) => item !== current)
  return { ...state, owed }
}

/** The server will never take this owed item (a 403 or a 404), so it goes. */
export const dropOwed = (state: DownloadsState, key: OwedKey): DownloadsState => {
  const current = owedOf(state, key)
  return current === null
    ? state
    : { ...state, owed: state.owed.filter((item) => item !== current) }
}

type SetSidecarsProps = { downloadId: string; sidecars: readonly Sidecar[] }

/** The subtitles a finished download keeps beside its video. */
export const setSidecars = (
  state: DownloadsState,
  { downloadId, sidecars }: SetSidecarsProps,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.sidecars.length === 0 && sidecars.length === 0
        ? entry
        : { ...entry, sidecars: [...sidecars] },
  })

type SetAutoDeleteProps = { downloadId: string; autoDelete: boolean; at: number }

/**
 * Switching the option on for a title already watched moves an older `watchedAt` up to `at`:
 * from then on it says when the ten-minute clock counts from, so the switch never deletes at
 * once, not even at the next launch. Nothing else reads it as a time, only against null.
 */
export const setAutoDelete = (
  state: DownloadsState,
  { downloadId, autoDelete, at }: SetAutoDeleteProps,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      if (entry.autoDelete === autoDelete) return entry
      const { watchedAt } = entry
      const isRestarted = autoDelete && watchedAt !== null && watchedAt < at
      return { ...entry, autoDelete, watchedAt: isRestarted ? at : watchedAt }
    },
  })

type SetAutoDeleteDefaultProps = { autoDelete: boolean }

export const setAutoDeleteDefault = (
  state: DownloadsState,
  { autoDelete }: SetAutoDeleteDefaultProps,
): DownloadsState =>
  state.autoDeleteDefault === autoDelete ? state : { ...state, autoDeleteDefault: autoDelete }

type NoteWatchedProps = {
  downloadId: string
  position: number
  duration: number | null
  at: number
}

/** Marks the first time playback reaches the library's Watched at; a later report never moves it. */
export const noteWatched = (
  state: DownloadsState,
  { downloadId, position, duration, at }: NoteWatchedProps,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      const total = duration ?? entry.duration
      if (entry.watchedAt !== null || total === null || total <= 0) return entry
      return position / total >= entry.watchedPercent / 100 ? { ...entry, watchedAt: at } : entry
    },
  })

type ForgetServerPositionProps = { downloadId: string }

/** A position was noted here, so the server's resume spot no longer says where the file starts. */
export const forgetServerPosition = (
  state: DownloadsState,
  { downloadId }: ForgetServerPositionProps,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => (entry.serverPosition === 0 ? entry : { ...entry, serverPosition: 0 }),
  })

type NotePendingProps = {
  downloadId: string
  play: boolean
  position: number
  at: number
  accountId: string | null
}

/**
 * `play` is sticky: a position report must not erase a play the server has not heard. `furthest`
 * only rises until a send clears it. What the entry held for another account moves to `owed`
 * first, so one account's report never folds into another's.
 */
export const notePending = (
  state: DownloadsState,
  { downloadId, play, position, at, accountId }: NotePendingProps,
): DownloadsState => {
  const current = entryById(state, { downloadId })
  if (current === null) return state
  const isOtherAccount = hasPending(current) && current.pending.accountId !== accountId
  const owed = isOtherAccount ? owe(state, { entries: [current] }) : state.owed
  const before = isOtherAccount ? NO_PENDING : current.pending
  return changeEntry(
    { ...state, owed },
    {
      downloadId,
      change: (entry) => ({
        ...entry,
        pending: {
          play: before.play || play,
          position,
          furthest: Math.max(before.furthest ?? position, position),
          at,
          accountId,
        },
      }),
    },
  )
}

/**
 * Clears what a sync sent. A position saved during the call differs from `sentPosition` and
 * stays, as a furthest raised during it differs from `sentFurthest`; a play is cleared only when
 * `sentPlay`, so one flagged by an open during a call that did not carry it stays too.
 */
export const clearPending = (
  state: DownloadsState,
  { downloadId, sentPlay, sentPosition, sentFurthest }: { downloadId: string } & Sent,
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      const pending = clearedOf(entry.pending, { sentPlay, sentPosition, sentFurthest })
      return pending === entry.pending ? entry : { ...entry, pending }
    },
  })

/** The group a row is in, as one string a `Map` can key by: its server and its `group.key`. */
const groupIdOf = ({ serverId, group }: DownloadEntry): string =>
  JSON.stringify([serverId, group.key])

type SameGroupProps = { a: DownloadEntry; b: DownloadEntry }

/** Whether two rows are one group: the same server and the same `group.key`, whatever their kind or title. */
export const sameGroup = ({ a, b }: SameGroupProps): boolean => groupIdOf(a) === groupIdOf(b)

/**
 * Newest group first, by the newest `createdAt` among its rows, with a group's rows together
 * in `group.order`. A lone row is a group of one, so it sorts by its own `createdAt`.
 */
export const sortDownloads = (entries: readonly DownloadEntry[]): DownloadEntry[] => {
  const keyed = entries.map((entry) => ({ entry, groupId: groupIdOf(entry) }))
  const newest = keyed.reduce(
    (latest, { entry, groupId }) =>
      latest.set(groupId, Math.max(latest.get(groupId) ?? entry.createdAt, entry.createdAt)),
    new Map<string, number>(),
  )
  return keyed
    .map((row) => ({ ...row, newest: newest.get(row.groupId) ?? row.entry.createdAt }))
    .toSorted(
      (a, b) =>
        b.newest - a.newest ||
        a.groupId.localeCompare(b.groupId) ||
        a.entry.group.order - b.entry.group.order ||
        b.entry.createdAt - a.entry.createdAt,
    )
    .map(({ entry }) => entry)
}
