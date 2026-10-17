import {
  type Infer,
  isBoolean,
  isMediaId,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@raven/core'
import { isContainerName, isDownloadGroup, isOpaqueId, isSidecarTrackId } from '@/shared/protocol'

export const DOWNLOADS_FILE = 'downloads.json'

/** A subtitle file kept beside the video: `trackId` is the server's `external-<n>`. */
export const isSidecar = object({ trackId: isSidecarTrackId, title: isString, language: isString })

/** A file's size as the server gives it: a whole number of bytes above 0, or nothing to fetch. */
export const isFileSize = (value: unknown): value is number =>
  isNumber(value) && Number.isSafeInteger(value) && value > 0

/** What the server has not heard yet: a play to record, and the last position to report. */
export const isPending = object({ play: isBoolean, position: nullable(isNumber), at: isNumber })

/** Why a download waits paused: the viewer paused it, or the queue did for the disk, a relock or an outage. */
export const isPauseReason = oneOf(['viewer', 'noSpace', 'relocked', 'unreachable'])

/** Why a download failed. Only `other` has words of its own, kept in the status's `message`. */
export const isFailReason = oneOf([
  'noSpace',
  'changed',
  'unauthorized',
  'unreachable',
  'gone',
  'other',
])

/**
 * A download's status as `downloads.json` keeps it: why it stopped is a reason, and the page's
 * words are built from it when the page reads it, so renaming a server changes no reason.
 */
export const isEntryStatus = union(
  object({ kind: oneOf(['queued']) }),
  object({ kind: oneOf(['downloading']), bytes: isNumber }),
  object({ kind: oneOf(['paused']), bytes: isNumber, reason: isPauseReason }),
  object({ kind: oneOf(['failed']), bytes: isNumber, reason: isFailReason, message: isString }),
  object({ kind: oneOf(['ready']) }),
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
  watchedPercent: isNumber,
  sidecars: listOf(isSidecar),
  status: isEntryStatus,
  autoDelete: isBoolean,
  watchedAt: nullable(isNumber),
  pending: isPending,
  createdAt: isNumber,
})

export const isDownloadsState = object({
  version: oneOf([1]),
  entries: listOf(isDownloadEntry),
  autoDeleteDefault: isBoolean,
})

export type PauseReason = Infer<typeof isPauseReason>
export type FailReason = Infer<typeof isFailReason>
export type EntryStatus = Infer<typeof isEntryStatus>
export type Sidecar = Infer<typeof isSidecar>
export type Pending = Infer<typeof isPending>
export type DownloadEntry = Infer<typeof isDownloadEntry>
export type DownloadsState = Infer<typeof isDownloadsState>

export const EMPTY_DOWNLOADS: DownloadsState = { version: 1, entries: [], autoDeleteDefault: false }

export const NO_PENDING: Pending = { play: false, position: null, at: 0 }

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
    case 'queued':
      return 0
    case 'ready':
      return entry.size
    case 'downloading':
    case 'paused':
    case 'failed':
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
        case 'queued':
          return withStatus(entry, { status: { kind: 'downloading', bytes: 0 } })
        case 'paused':
        case 'failed':
        case 'downloading':
        case 'ready':
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
      entry.status.kind === 'downloading' && entry.status.bytes !== bytes
        ? withStatus(entry, { status: { kind: 'downloading', bytes } })
        : entry,
  })

const isPausable = (entry: DownloadEntry): boolean =>
  entry.status.kind === 'queued' || entry.status.kind === 'downloading'

const paused = (entry: DownloadEntry, { reason }: { reason: PauseReason }): DownloadEntry =>
  isPausable(entry)
    ? withStatus(entry, { status: { kind: 'paused', bytes: bytesOf(entry), reason } })
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
  (status.kind === 'paused' || status.kind === 'failed') && status.reason === 'unreachable'

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
        ? withStatus(entry, { status: { kind: 'paused', bytes: bytesOf(entry), reason: 'viewer' } })
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
      entry.status.kind === 'paused' || entry.status.kind === 'failed'
        ? withStatus(entry, { status: { kind: 'queued' } })
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
      entry.status.kind === 'ready'
        ? entry
        : withStatus(entry, {
            status: { kind: 'failed', bytes: bytesOf(entry), reason, message },
          }),
  })

export const finish = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === 'ready' ? entry : withStatus(entry, { status: { kind: 'ready' } }),
  })

export const remove = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
  entryById(state, { downloadId })
    ? { ...state, entries: state.entries.filter((entry) => entry.downloadId !== downloadId) }
    : state

export const removeAll = (state: DownloadsState): DownloadsState =>
  state.entries.length === 0 ? state : { ...state, entries: [] }

export const removeServer = (
  state: DownloadsState,
  { serverId }: { serverId: string },
): DownloadsState => {
  const kept = state.entries.filter((entry) => entry.serverId !== serverId)
  return kept.length === state.entries.length ? state : { ...state, entries: kept }
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

export const setAutoDelete = (
  state: DownloadsState,
  { downloadId, autoDelete }: { downloadId: string; autoDelete: boolean },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => (entry.autoDelete === autoDelete ? entry : { ...entry, autoDelete }),
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

/** `play` is sticky: a position report must not erase a play the server has not heard. */
export const notePending = (
  state: DownloadsState,
  {
    downloadId,
    play,
    position,
    at,
  }: { downloadId: string; play: boolean; position: number | null; at: number },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => ({
      ...entry,
      pending: { play: entry.pending.play || play, position, at },
    }),
  })

/**
 * Clears what a sync sent. A position saved during the call differs from `sentPosition` and
 * stays; a play is cleared only when `sentPlay`, so one flagged by an open during a call that
 * did not carry it stays too.
 */
export const clearPending = (
  state: DownloadsState,
  {
    downloadId,
    sentPlay,
    sentPosition,
  }: { downloadId: string; sentPlay: boolean; sentPosition: number | null },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      const position = entry.pending.position === sentPosition ? null : entry.pending.position
      const play = sentPlay ? false : entry.pending.play
      if (play === entry.pending.play && position === entry.pending.position) return entry
      return { ...entry, pending: { ...entry.pending, play, position } }
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
