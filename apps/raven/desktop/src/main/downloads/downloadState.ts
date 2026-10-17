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
} from '@raven/core'
import {
  isDownloadGroup,
  isDownloadStatus,
  isOpaqueId,
  type DownloadStatus,
} from '@/shared/protocol'

export const DOWNLOADS_FILE = 'downloads.json'

/** A subtitle file kept beside the video: `trackId` is the server's `external-<n>`. */
const isSidecar = object({ trackId: isString, title: isString, language: isString })

/** What the server has not heard yet: a play to record, and the last position to report. */
const isPending = object({ play: isBoolean, position: nullable(isNumber), at: isNumber })

export const isDownloadEntry = object({
  downloadId: isOpaqueId,
  serverId: isOpaqueId,
  mediaId: isMediaId,
  label: isString,
  group: isDownloadGroup,
  container: isString,
  size: isNumber,
  duration: nullable(isNumber),
  watchedPercent: isNumber,
  sidecars: listOf(isSidecar),
  status: isDownloadStatus,
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

const withStatus = (
  entry: DownloadEntry,
  { status }: { status: DownloadStatus },
): DownloadEntry => ({
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

export const start = (
  state: DownloadsState,
  { downloadId }: { downloadId: string },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      switch (entry.status.kind) {
        case 'queued':
        case 'paused':
        case 'failed':
          return withStatus(entry, { status: { kind: 'downloading', bytes: bytesOf(entry) } })
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
      entry.status.kind === 'downloading'
        ? withStatus(entry, { status: { kind: 'downloading', bytes } })
        : entry,
  })

const isPausable = (entry: DownloadEntry): boolean =>
  entry.status.kind === 'queued' || entry.status.kind === 'downloading'

const paused = (entry: DownloadEntry, { message }: { message: string | null }): DownloadEntry =>
  isPausable(entry)
    ? withStatus(entry, { status: { kind: 'paused', bytes: bytesOf(entry), message } })
    : entry

export const pause = (
  state: DownloadsState,
  { downloadId, message }: { downloadId: string; message: string | null },
): DownloadsState =>
  changeEntry(state, { downloadId, change: (entry) => paused(entry, { message }) })

export const pauseServer = (
  state: DownloadsState,
  { serverId, message }: { serverId: string; message: string | null },
): DownloadsState => {
  const isTouched = (entry: DownloadEntry): boolean =>
    entry.serverId === serverId && isPausable(entry)
  if (!state.entries.some(isTouched)) return state
  return {
    ...state,
    entries: state.entries.map((entry) => (isTouched(entry) ? paused(entry, { message }) : entry)),
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

export const fail = (
  state: DownloadsState,
  { downloadId, message }: { downloadId: string; message: string },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) =>
      entry.status.kind === 'ready'
        ? entry
        : withStatus(entry, { status: { kind: 'failed', bytes: bytesOf(entry), message } }),
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

export const removeServer = (
  state: DownloadsState,
  { serverId }: { serverId: string },
): DownloadsState => {
  const kept = state.entries.filter((entry) => entry.serverId !== serverId)
  return kept.length === state.entries.length ? state : { ...state, entries: kept }
}

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
    change: (entry) => ({ ...entry, pending: { play, position, at } }),
  })

/** Clears what a sync sent; a position saved during the call differs from `sentPosition` and stays. */
export const clearPending = (
  state: DownloadsState,
  { downloadId, sentPosition }: { downloadId: string; sentPosition: number | null },
): DownloadsState =>
  changeEntry(state, {
    downloadId,
    change: (entry) => {
      const position = entry.pending.position === sentPosition ? null : entry.pending.position
      if (!entry.pending.play && position === entry.pending.position) return entry
      return { ...entry, pending: { ...entry.pending, play: false, position } }
    },
  })

const groupKey = (entry: DownloadEntry): string =>
  JSON.stringify([entry.serverId, entry.group.title])

/**
 * Newest group first, by the newest `createdAt` among its rows, with a group's rows together
 * in `group.order`. A lone row is a group of one, so it sorts by its own `createdAt`.
 */
export const sortDownloads = (entries: readonly DownloadEntry[]): DownloadEntry[] => {
  const newestOf = (entry: DownloadEntry): number =>
    entries
      .filter((other) => groupKey(other) === groupKey(entry))
      .reduce((newest, other) => Math.max(newest, other.createdAt), entry.createdAt)
  const ranked = entries.map((entry) => ({ entry, key: groupKey(entry), newest: newestOf(entry) }))
  return ranked
    .toSorted(
      (a, b) =>
        b.newest - a.newest ||
        a.key.localeCompare(b.key) ||
        a.entry.group.order - b.entry.group.order ||
        b.entry.createdAt - a.entry.createdAt,
    )
    .map(({ entry }) => entry)
}
