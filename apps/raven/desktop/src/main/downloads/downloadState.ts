import {
  type Infer,
  isBoolean,
  isMediaId,
  isNumber,
  isString,
  isWatchedPercent,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@raven/core'
import {
  DOWNLOAD_STATUS_KINDS,
  isContainerName,
  isDownloadGroup,
  isOpaqueId,
  isSidecarTrackId,
} from '@/shared/protocol'

export const DOWNLOADS_FILE = 'downloads.json'

/** A subtitle file kept beside the video: `trackId` is the server's `external-<n>`. */
const isSidecar = object({ trackId: isSidecarTrackId, title: isString, language: isString })

/** A file's size as the server gives it: a whole number of bytes above 0, or nothing to fetch. */
export const isFileSize = (value: unknown): value is number =>
  isNumber(value) && Number.isSafeInteger(value) && value > 0

/**
 * What the server has not heard yet: a play to record, the last position to report, and the
 * furthest position since the last send. The server keeps how far a play got as the most it
 * hears, so a scrub back after the end must not be all it hears.
 */
const isPending = object({
  play: isBoolean,
  position: nullable(isNumber),
  furthest: nullable(isNumber),
  at: isNumber,
})

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

export const isDownloadEntry = object({
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
  pending: isPending,
  createdAt: isNumber,
})

/**
 * What a removed download still owed its server, kept until the server hears it: removing a
 * download offline, as its auto-delete does, must not lose what was watched. One item per title.
 */
const isOwed = object({ serverId: isOpaqueId, mediaId: isMediaId, pending: isPending })

export const isDownloadsState = object({
  version: oneOf([1]),
  entries: listOf(isDownloadEntry),
  autoDeleteDefault: isBoolean,
  owed: listOf(isOwed),
})

export type PauseReason = Infer<typeof isPauseReason>
export type FailReason = Infer<typeof isFailReason>
export type EntryStatus = Infer<typeof isEntryStatus>
export type Sidecar = Infer<typeof isSidecar>
export type Pending = Infer<typeof isPending>
export type DownloadEntry = Infer<typeof isDownloadEntry>
export type Owed = Infer<typeof isOwed>
export type DownloadsState = Infer<typeof isDownloadsState>

export const EMPTY_DOWNLOADS: DownloadsState = {
  version: 1,
  entries: [],
  autoDeleteDefault: false,
  owed: [],
}

export const NO_PENDING: Pending = { play: false, position: null, furthest: null, at: 0 }

export const entryById = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadEntry | null => state.entries.find((entry) => entry.downloadId === downloadId) ?? null

export const entryByMedia = (
  state: DownloadsState,
  { serverId, mediaId }: { serverId: string; mediaId: number },
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

/**
 * Applies `change` to one entry. An unknown id, or a `change` that hands the entry back,
 * returns `state` itself, so `JsonStore.update` sees no change and writes nothing.
 */
const changeEntry = (
  state: DownloadsState,
  { downloadId, change }: { downloadId: string; change: (entry: DownloadEntry) => DownloadEntry },
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

const withStatus = (entry: DownloadEntry, { status }: { status: EntryStatus }): DownloadEntry => ({
  ...entry,
  status,
})

export const queue = (
  state: DownloadsState,
  { entries }: { entries: readonly DownloadEntry[] },
): DownloadsState => {
  const added = entries.reduce<DownloadEntry[]>((kept, entry) => {
    const isKnown = [...state.entries, ...kept].some(
      (known) => known.serverId === entry.serverId && known.mediaId === entry.mediaId,
    )
    return isKnown ? kept : [...kept, entry]
  }, [])
  if (added.length === 0) return state
  return { ...state, entries: [...state.entries, ...added] }
}

/**
 * Only a queued file starts: a run begins for one, and a pause or a failure that came while it
 * read its ticket must stand.
 */
export const start = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
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

export const advance = (
  state: DownloadsState,
  { downloadId, bytes }: { downloadId: string; bytes: number },
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

const paused = (entry: DownloadEntry, { reason }: { reason: PauseReason }): DownloadEntry =>
  isPausable(entry)
    ? withStatus(entry, {
        status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: bytesOf(entry), reason },
      })
    : entry

export const pause = (
  state: DownloadsState,
  { downloadId, reason }: { downloadId: string; reason: PauseReason },
): DownloadsState =>
  changeEntry(state, { downloadId, change: (entry) => paused(entry, { reason }) })

export const pauseServer = (
  state: DownloadsState,
  { serverId, reason }: { serverId: string; reason: PauseReason },
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

export const resume = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.paused ||
      entry.status.kind === DOWNLOAD_STATUS_KINDS.failed
        ? withStatus(entry, { status: { kind: DOWNLOAD_STATUS_KINDS.queued } })
        : entry,
  })

/** `message` is the words of an `other` failure; every other reason says it all and keeps none. */
export const fail = (
  state: DownloadsState,
  {
    downloadId,
    reason,
    message = '',
  }: { downloadId: string; reason: FailReason; message?: string },
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

export const finish = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.ready
        ? entry
        : withStatus(entry, { status: { kind: DOWNLOAD_STATUS_KINDS.ready } }),
  })

/** Whether the server has yet to hear something of this download or owed item. */
export const hasPending = ({ pending }: { pending: Pending }): boolean =>
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

type Title = { serverId: string; mediaId: number }

const isTitle =
  ({ serverId, mediaId }: Title) =>
  (item: Title): boolean =>
    item.serverId === serverId && item.mediaId === mediaId

export const owedOf = (state: DownloadsState, title: Title): Owed | null =>
  state.owed.find(isTitle(title)) ?? null

/** The higher of two positions, either of which may be none. */
const furthestOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : Math.max(a, b ?? a)

/**
 * Two pending records of one title as one: a play either owes, the newer last position, and the
 * furthest of both (never below that position), as `notePending` folds a report into what is
 * pending.
 */
const mergePending = ({ a, b }: { a: Pending; b: Pending }): Pending => {
  const [older, newer] = a.at <= b.at ? [a, b] : [b, a]
  const position = newer.position ?? older.position
  const furthest = furthestOf(a.furthest, b.furthest)
  return {
    play: a.play || b.play,
    position,
    furthest: position === null || furthest === null ? furthest : Math.max(furthest, position),
    at: newer.at,
  }
}

/** `owed` with what these removed entries still owed their servers folded in. */
const owe = (state: DownloadsState, { entries }: { entries: readonly DownloadEntry[] }): Owed[] =>
  entries.filter(hasPending).reduce<Owed[]>((owed, { serverId, mediaId, pending }) => {
    const known = owed.find(isTitle({ serverId, mediaId }))
    if (known === undefined) return [...owed, { serverId, mediaId, pending }]
    const merged = { ...known, pending: mergePending({ a: known.pending, b: pending }) }
    return owed.map((item) => (item === known ? merged : item))
  }, state.owed)

/** Drops one entry; what the server has not heard of it moves to `owed` in the same change. */
export const remove = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState => {
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

/**
 * Drops a server's entries and what it was owed: raven player no longer keeps the server, so
 * nothing could reach it.
 */
export const removeServer = (
  state: DownloadsState,
  { serverId }: { serverId: string },
): DownloadsState => {
  const kept = state.entries.filter((entry) => entry.serverId !== serverId)
  const owed = state.owed.filter((item) => item.serverId !== serverId)
  return kept.length === state.entries.length && owed.length === state.owed.length
    ? state
    : { ...state, entries: kept, owed }
}

/** What the server took is no longer owed; an item it took all of goes. */
export const clearOwed = (
  state: DownloadsState,
  { serverId, mediaId, sentPlay, sentPosition, sentFurthest }: Title & Sent,
): DownloadsState => {
  const current = owedOf(state, { serverId, mediaId })
  if (current === null) return state
  const pending = clearedOf(current.pending, { sentPlay, sentPosition, sentFurthest })
  if (pending === current.pending) return state
  const owed = hasPending({ pending })
    ? state.owed.map((item) => (item === current ? { ...item, pending } : item))
    : state.owed.filter((item) => item !== current)
  return { ...state, owed }
}

/** The server will never take this owed item (a 403 or a 404), so it goes. */
export const dropOwed = (state: DownloadsState, title: Title): DownloadsState => {
  const current = owedOf(state, title)
  return current === null
    ? state
    : { ...state, owed: state.owed.filter((item) => item !== current) }
}

/** The subtitles a finished download keeps beside its video. */
export const setSidecars = (
  state: DownloadsState,
  { downloadId, sidecars }: { downloadId: string; sidecars: readonly Sidecar[] },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.sidecars.length === 0 && sidecars.length === 0
        ? entry
        : { ...entry, sidecars: [...sidecars] },
  })

/**
 * Switching the option on for a title already watched moves an older `watchedAt` up to `at`:
 * from then on it says when the ten-minute clock counts from, so the switch never deletes at
 * once, not even at the next launch. Nothing else reads it as a time, only against null.
 */
export const setAutoDelete = (
  state: DownloadsState,
  { downloadId, autoDelete, at }: { downloadId: string; autoDelete: boolean; at: number },
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

export const setAutoDeleteDefault = (
  state: DownloadsState,
  { autoDelete }: { autoDelete: boolean },
): DownloadsState =>
  state.autoDeleteDefault === autoDelete ? state : { ...state, autoDeleteDefault: autoDelete }

/** Marks the first time playback reaches the library's Watched at; a later report never moves it. */
export const noteWatched = (
  state: DownloadsState,
  {
    downloadId,
    position,
    duration,
    at,
  }: { downloadId: string; position: number; duration: number | null; at: number },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      const total = duration ?? entry.duration
      if (entry.watchedAt !== null || total === null || total <= 0) return entry
      return position / total >= entry.watchedPercent / 100 ? { ...entry, watchedAt: at } : entry
    },
  })

/** A position was noted here, so the server's resume spot no longer says where the file starts. */
export const forgetServerPosition = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => (entry.serverPosition === 0 ? entry : { ...entry, serverPosition: 0 }),
  })

/**
 * `play` is sticky: a position report must not erase a play the server has not heard. `furthest`
 * only rises until a send clears it.
 */
export const notePending = (
  state: DownloadsState,
  {
    downloadId,
    play,
    position,
    at,
  }: { downloadId: string; play: boolean; position: number; at: number },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => ({
      ...entry,
      pending: {
        play: entry.pending.play || play,
        position,
        furthest: Math.max(entry.pending.furthest ?? position, position),
        at,
      },
    }),
  })

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

/** Whether two rows are one group: the same server and the same `group.key`, whatever their kind or title. */
export const sameGroup = ({ a, b }: { a: DownloadEntry; b: DownloadEntry }): boolean =>
  groupIdOf(a) === groupIdOf(b)

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
