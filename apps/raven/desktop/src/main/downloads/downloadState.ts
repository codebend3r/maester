import {
  DOWNLOAD_STATUS_KINDS,
  type DownloadLibrary,
  type Infer,
  isBoolean,
  isContainerName,
  isDownloadArtwork,
  isDownloadFacts,
  isDownloadGroup,
  isDownloadLibrary,
  isMediaId,
  isNumber,
  isOpaqueId,
  isSidecarTrackId,
  isString,
  isTrack,
  isWatchedPercent,
  listOf,
  nullable,
  object,
  oneOf,
  optional,
  union,
} from '@raven/core'
import { isAccountRefusal } from '@/main/servers/authRefusals'

export const DOWNLOADS_FILE = 'downloads.json'

/** The version `downloads.json` is written at. */
export const DOWNLOADS_VERSION = 3

/** A subtitle file kept beside the video: `trackId` is the server's `external-<n>`. */
const isSidecar = object({ trackId: isSidecarTrackId, title: isString, language: isString })

/** A file's size as the server gives it: a whole number of bytes above 0, or nothing to fetch. */
export const isFileSize = (value: unknown): value is number =>
  isNumber(value) && Number.isSafeInteger(value) && value > 0

export const PENDING_FIELDS = {
  play: isBoolean,
  position: nullable(isNumber),
  furthest: nullable(isNumber),
  at: isNumber,
}

/**
 * What the server has not heard yet: a play to record, the last position to report, and the
 * furthest position since the last send. The server keeps how far a play got as the most it
 * hears, so a scrub back after the end must not be all it hears. `accountId` is the account
 * signed in to the server when it was noted, sent only under that account; null for what was
 * noted before plays belonged to an account, which goes to whoever is signed in.
 */
export const isPending = object({ ...PENDING_FIELDS, accountId: nullable(isString) })

/** Why a download waits paused: the viewer paused it, or the queue did for the disk, a relock or an outage. */
export const PAUSE_REASONS = {
  viewer: 'viewer',
  noSpace: 'noSpace',
  relocked: 'relocked',
  unreachable: 'unreachable',
} as const

const isPauseReason = oneOf(Object.values(PAUSE_REASONS))

/**
 * Why a download failed. `account` keeps why the server refused the account and `other` its own
 * words; every other reason says it all.
 */
export const FAIL_REASONS = {
  noSpace: 'noSpace',
  changed: 'changed',
  unreachable: 'unreachable',
  gone: 'gone',
  account: 'account',
  other: 'other',
} as const

/** The failures that need nothing besides their reason. */
const isPlainFailReason = oneOf([
  FAIL_REASONS.noSpace,
  FAIL_REASONS.changed,
  FAIL_REASONS.unreachable,
  FAIL_REASONS.gone,
])

export const QUEUED = object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.queued]) })
export const DOWNLOADING = object({
  kind: oneOf([DOWNLOAD_STATUS_KINDS.downloading]),
  bytes: isNumber,
})
export const PAUSED = object({
  kind: oneOf([DOWNLOAD_STATUS_KINDS.paused]),
  bytes: isNumber,
  reason: isPauseReason,
})
export const READY = object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.ready]) })

const PLAIN_FAILURE = object({ reason: isPlainFailReason })
const ACCOUNT_FAILURE = object({
  reason: oneOf([FAIL_REASONS.account]),
  refusal: isAccountRefusal,
})
const OTHER_FAILURE = object({ reason: oneOf([FAIL_REASONS.other]), message: isString })

/** Why a download failed, as an entry keeps it: the reason, and what that reason needs. */
const isFailure = union(PLAIN_FAILURE, ACCOUNT_FAILURE, OTHER_FAILURE)

/** What every failed status keeps besides why: the kind, and the bytes already on disk. */
const FAILED_FIELDS = { kind: oneOf([DOWNLOAD_STATUS_KINDS.failed]), bytes: isNumber }

export type Failure = Infer<typeof isFailure>

/**
 * A download's status as `downloads.json` keeps it: why it stopped is a reason, and the page's
 * words are built from it when the page reads it.
 */
const isEntryStatus = union(
  QUEUED,
  DOWNLOADING,
  PAUSED,
  object({ ...FAILED_FIELDS, ...PLAIN_FAILURE.shape }),
  object({ ...FAILED_FIELDS, ...ACCOUNT_FAILURE.shape }),
  object({ ...FAILED_FIELDS, ...OTHER_FAILURE.shape }),
  READY,
)

/** The kinds of picture file a download keeps, by the extension each is saved under. */
export const PICTURE_EXTENSIONS = { jpg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' } as const

export const isPictureExtension = oneOf(Object.values(PICTURE_EXTENSIONS))

export type PictureExtension = Infer<typeof isPictureExtension>

/** What a picture folder is named after: the item whose art it holds, or the album whose cover. */
export const PICTURE_OWNERS = { item: 'item', album: 'album' } as const

export type PictureOwner = (typeof PICTURE_OWNERS)[keyof typeof PICTURE_OWNERS]

const PICTURE_FOLDER = new RegExp(
  `^(?:${Object.values(PICTURE_OWNERS).join('|')})-[1-9]\\d{0,15}$`,
  'u',
)

/** A picture folder's name, `item-<id>` or `album-<id>`, which is all a path is ever built from. */
export const isPictureFolder = (value: unknown): value is string =>
  isString(value) && PICTURE_FOLDER.test(value)

/*
 * A picture on disk: `pictures/<folder>/<id>.<extension>` under its server's downloads. The id is
 * all the page ever holds of it.
 */
const isSavedPicture = object({
  id: isOpaqueId,
  folder: isPictureFolder,
  extension: isPictureExtension,
})

export type SavedPicture = Infer<typeof isSavedPicture>

/*
 * The pictures an entry shows from disk, shared by every entry of its title or album. Not
 * `isComplete` while one could not be fetched, so the next pass asks again; complete with a null
 * means the server has none.
 */
const isEntryPictures = object({
  art: nullable(isSavedPicture),
  logo: nullable(isSavedPicture),
  isComplete: isBoolean,
})

export type EntryPictures = Infer<typeof isEntryPictures>

/**
 * What the Downloads page shows of an entry besides: its pictures, its library and the facts its
 * grid sorts on. A file written before they were kept has none of them, which is fine, so each is
 * optional; `library` and `titleItemId` are filled in together, from the server.
 */
export const ENTRY_FIELDS = {
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
  autoDelete: isBoolean,
  watchedAt: nullable(isNumber),
  /**
   * Where the server had playback when the download was confirmed, so a title streamed partway
   * opens there; 0 once a position is noted here, after which the local resume spot decides.
   */
  serverPosition: isNumber,
  createdAt: isNumber,
  /** A track's `Track`, kept so Downloads queues it with no server; none for a video. */
  track: optional(isTrack),
  artwork: optional(isDownloadArtwork),
  facts: optional(isDownloadFacts),
  library: optional(isDownloadLibrary),
  /** The item whose poster and title art a video wears, its show's for an episode; null for none. */
  titleItemId: optional(nullable(isMediaId)),
  pictures: optional(isEntryPictures),
}

export const isDownloadEntry = object({
  ...ENTRY_FIELDS,
  status: isEntryStatus,
  pending: isPending,
})

export type DownloadEntry = Infer<typeof isDownloadEntry>

/**
 * What a removed download still owed its server, kept until the server hears it: removing a
 * download offline, as its auto-delete does, must not lose what was watched. What an account
 * watched waits here too once another signs in. One item per title and account.
 */
export const OWED_FIELDS = { serverId: isOpaqueId, mediaId: isMediaId }

export const isOwed = object({ ...OWED_FIELDS, pending: isPending })

export const isDownloadsState = object({
  version: oneOf([DOWNLOADS_VERSION]),
  entries: listOf(isDownloadEntry),
  autoDeleteDefault: isBoolean,
  owed: listOf(isOwed),
})

export type PauseReason = Infer<typeof isPauseReason>
export type EntryStatus = Infer<typeof isEntryStatus>
export type Sidecar = Infer<typeof isSidecar>
export type Pending = Infer<typeof isPending>
export type Owed = Infer<typeof isOwed>
export type DownloadsState = Infer<typeof isDownloadsState>

export const EMPTY_DOWNLOADS: DownloadsState = {
  version: DOWNLOADS_VERSION,
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

/** A reducer's input: the state, and what it changes. */
type WithState<P> = P & { state: DownloadsState }

type EntryByIdProps = WithState<{ downloadId: string }>

export const entryById = ({ state, downloadId }: EntryByIdProps): DownloadEntry | null =>
  state.entries.find((entry) => entry.downloadId === downloadId) ?? null

type EntryByMediaProps = WithState<{ serverId: string; mediaId: number }>

export const entryByMedia = ({
  state,
  serverId,
  mediaId,
}: EntryByMediaProps): DownloadEntry | null =>
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

type ChangeEntryProps = WithState<{
  downloadId: string
  change: (entry: DownloadEntry) => DownloadEntry
}>

/**
 * Applies `change` to one entry. An unknown id, or a `change` that hands the entry back,
 * returns `state` itself, so `JsonStore.update` sees no change and writes nothing.
 */
const changeEntry = ({ state, downloadId, change }: ChangeEntryProps): DownloadsState => {
  const current = entryById({ state, downloadId })
  if (current === null) return state
  const next = change(current)
  if (next === current) return state
  return {
    ...state,
    entries: state.entries.map((entry) => (entry === current ? next : entry)),
  }
}

type ChangeEachProps = WithState<{
  isTouched: (entry: DownloadEntry) => boolean
  change: (entry: DownloadEntry) => DownloadEntry
}>

/** Applies `change` to every entry `isTouched` picks; the same state when it picks none. */
const changeEach = ({ state, isTouched, change }: ChangeEachProps): DownloadsState => {
  if (!state.entries.some(isTouched)) return state
  return {
    ...state,
    entries: state.entries.map((entry) => (isTouched(entry) ? change(entry) : entry)),
  }
}

type QueueProps = WithState<{ entries: readonly DownloadEntry[] }>

export const queue = ({ state, entries }: QueueProps): DownloadsState => {
  const added = entries.reduce<DownloadEntry[]>((kept, entry) => {
    const isKnown = [...state.entries, ...kept].some(
      (known) => known.serverId === entry.serverId && known.mediaId === entry.mediaId,
    )
    return isKnown ? kept : [...kept, entry]
  }, [])
  if (added.length === 0) return state
  return { ...state, entries: [...state.entries, ...added] }
}

type StartProps = WithState<{ downloadId: string }>

/**
 * Only a queued file starts: a run begins for one, and a pause or a failure that came while it
 * read its ticket must stand.
 */
export const start = ({ state, downloadId }: StartProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.queued
        ? { ...entry, status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 } }
        : entry,
  })

type AdvanceProps = WithState<{ downloadId: string; bytes: number }>

export const advance = ({ state, downloadId, bytes }: AdvanceProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.downloading && entry.status.bytes !== bytes
        ? { ...entry, status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes } }
        : entry,
  })

/** Whether a file waits to start or is fetching: what the queue still has to do. */
export const isUnderWay = ({ status }: DownloadEntry): boolean =>
  status.kind === DOWNLOAD_STATUS_KINDS.queued || status.kind === DOWNLOAD_STATUS_KINDS.downloading

type PausedProps = { entry: DownloadEntry; reason: PauseReason }

const paused = ({ entry, reason }: PausedProps): DownloadEntry => ({
  ...entry,
  status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: bytesOf(entry), reason },
})

type PauseProps = WithState<{ downloadId: string; reason: PauseReason }>

export const pause = ({ state, downloadId, reason }: PauseProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) => (isUnderWay(entry) ? paused({ entry, reason }) : entry),
  })

type PauseUnderWayProps = WithState<{ reason: PauseReason }>

/** Every file still under way waits paused for `reason`. */
export const pauseUnderWay = ({ state, reason }: PauseUnderWayProps): DownloadsState =>
  changeEach({ state, isTouched: isUnderWay, change: (entry) => paused({ entry, reason }) })

/** Whether a file waits on an outage, which the queue tries again on its own. */
export const isWaitingOnOutage = ({ status }: DownloadEntry): boolean =>
  (status.kind === DOWNLOAD_STATUS_KINDS.paused && status.reason === PAUSE_REASONS.unreachable) ||
  (status.kind === DOWNLOAD_STATUS_KINDS.failed && status.reason === FAIL_REASONS.unreachable)

/** Whether a file waits paused because its server locked its library again. */
export const isRelocked = ({ status }: DownloadEntry): boolean =>
  status.kind === DOWNLOAD_STATUS_KINDS.paused && status.reason === PAUSE_REASONS.relocked

/**
 * The viewer's Pause all: what runs or waits pauses, and so does what waits on an outage, or
 * the outage retry would start it again. A relocked file keeps its reason, so it still unlocks.
 */
export const pauseEverything = (state: DownloadsState): DownloadsState =>
  changeEach({
    state,
    isTouched: (entry) => isUnderWay(entry) || isWaitingOnOutage(entry),
    change: (entry) => paused({ entry, reason: PAUSE_REASONS.viewer }),
  })

type ResumeProps = WithState<{ downloadId: string }>

export const resume = ({ state, downloadId }: ResumeProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.paused ||
      entry.status.kind === DOWNLOAD_STATUS_KINDS.failed
        ? { ...entry, status: { kind: DOWNLOAD_STATUS_KINDS.queued } }
        : entry,
  })

type FailProps = WithState<{ downloadId: string; failure: Failure }>

/** A ready file stays ready: its video is in place whatever came after. */
export const fail = ({ state, downloadId, failure }: FailProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.ready
        ? entry
        : {
            ...entry,
            status: { ...failure, kind: DOWNLOAD_STATUS_KINDS.failed, bytes: bytesOf(entry) },
          },
  })

type FinishProps = WithState<{ downloadId: string }>

export const finish = ({ state, downloadId }: FinishProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) =>
      entry.status.kind === DOWNLOAD_STATUS_KINDS.ready
        ? entry
        : { ...entry, status: { kind: DOWNLOAD_STATUS_KINDS.ready } },
  })

type HasPendingProps = { pending: Pending }

/** Whether the server has yet to hear something of this download or owed item. */
export const hasPending = ({ pending }: HasPendingProps): boolean =>
  pending.play || pending.position !== null || pending.furthest !== null

/** What one round of a sync sent: the play, if it went, and the positions it carried. */
type Sent = { sentPlay: boolean; sentPosition: number | null; sentFurthest: number | null }

type ClearedOfProps = Sent & { pending: Pending }

/** `pending` less what a sync sent; the same object when the send cleared nothing. */
const clearedOf = ({ pending, sentPlay, sentPosition, sentFurthest }: ClearedOfProps): Pending => {
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

type OwedOfProps = WithState<OwedKey>

export const owedOf = ({ state, ...key }: OwedOfProps): Owed | null =>
  state.owed.find(isOwedAs(key)) ?? null

type FurthestOfProps = { a: number | null; b: number | null }

/** The higher of two positions, either of which may be none. */
const furthestOf = ({ a, b }: FurthestOfProps): number | null =>
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
  const furthest = furthestOf({ a: a.furthest, b: b.furthest })
  return {
    play: a.play || b.play,
    position,
    furthest: position === null || furthest === null ? furthest : Math.max(furthest, position),
    at: newer.at,
    accountId: newer.accountId,
  }
}

type OweInProps = { owed: readonly Owed[]; item: Owed }

/** `owed` with `item` folded in: merged into the item of its title and account, else added. */
const oweIn = ({ owed, item }: OweInProps): Owed[] => {
  const { serverId, mediaId, pending } = item
  const known = owed.find(isOwedAs({ serverId, mediaId, accountId: pending.accountId }))
  if (known === undefined) return [...owed, item]
  const merged = { ...known, pending: mergePending({ a: known.pending, b: pending }) }
  return owed.map((each) => (each === known ? merged : each))
}

type OweProps = WithState<{ entries: readonly DownloadEntry[] }>

/**
 * `owed` with what these entries still owe their servers folded in, one item per title and
 * account: what one account watched never folds into another's.
 */
const owe = ({ state, entries }: OweProps): Owed[] =>
  entries
    .filter(hasPending)
    .reduce<Owed[]>(
      (owed, { serverId, mediaId, pending }) =>
        oweIn({ owed, item: { serverId, mediaId, pending } }),
      state.owed,
    )

type OweOtherAccountsProps = WithState<{ serverId: string; accountId: string | null }>

/**
 * The account signed in to a server changed: what its downloads hold pending for any other
 * account moves to `owed` under that account, where it waits until that account signs in to the
 * server again. What was noted for no account stays, for whoever is signed in.
 */
export const oweOtherAccounts = ({
  state,
  serverId,
  accountId,
}: OweOtherAccountsProps): DownloadsState => {
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
    owed: owe({ state, entries: owing }),
  }
}

type RemoveProps = WithState<{ downloadId: string }>

/** Drops one entry; what the server has not heard of it moves to `owed` in the same change. */
export const remove = ({ state, downloadId }: RemoveProps): DownloadsState => {
  const removed = entryById({ state, downloadId })
  if (removed === null) return state
  return {
    ...state,
    entries: state.entries.filter((entry) => entry !== removed),
    owed: owe({ state, entries: [removed] }),
  }
}

/** Drops every entry; what the servers have not heard of them moves to `owed`. */
export const removeAll = (state: DownloadsState): DownloadsState =>
  state.entries.length === 0
    ? state
    : { ...state, entries: [], owed: owe({ state, entries: state.entries }) }

type IsSameListProps<T> = { left: readonly T[]; right: readonly T[] }

const isSameList = <T>({ left, right }: IsSameListProps<T>): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index])

type KeepOneServerProps = WithState<{
  serverId: string
  adopted: readonly string[]
  moved: ReadonlySet<string>
}>

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
  /*
   * An adopted server's download that stayed where it was (a twin of a title the server has, or a
   * folder that could not move) still owes what was watched of it, now to the server.
   */
  const unmoved = state.entries
    .filter(
      (entry) =>
        entry.serverId !== serverId &&
        adopted.includes(entry.serverId) &&
        !moved.has(entry.downloadId),
    )
    .map((entry) => ({ ...entry, serverId }))
  const carried = state.owed
    .filter((item) => item.serverId === serverId || adopted.includes(item.serverId))
    .reduce<Owed[]>(
      (kept, item) =>
        oweIn({ owed: kept, item: item.serverId === serverId ? item : { ...item, serverId } }),
      [],
    )
  const owed = owe({ state: { ...state, owed: carried }, entries: unmoved })
  return isSameList({ left: entries, right: state.entries }) &&
    isSameList({ left: owed, right: state.owed })
    ? state
    : { ...state, entries, owed }
}

type ClearOwedProps = WithState<OwedKey & Sent>

/** What the server took is no longer owed; an item it took all of goes. */
export const clearOwed = ({
  state,
  serverId,
  mediaId,
  accountId,
  sentPlay,
  sentPosition,
  sentFurthest,
}: ClearOwedProps): DownloadsState => {
  const current = owedOf({ state, serverId, mediaId, accountId })
  if (current === null) return state
  const pending = clearedOf({ pending: current.pending, sentPlay, sentPosition, sentFurthest })
  if (pending === current.pending) return state
  const owed = hasPending({ pending })
    ? state.owed.map((item) => (item === current ? { ...item, pending } : item))
    : state.owed.filter((item) => item !== current)
  return { ...state, owed }
}

type DropOwedProps = WithState<OwedKey>

/** The server will never take this owed item (a 403 or a 404), so it goes. */
export const dropOwed = ({ state, ...key }: DropOwedProps): DownloadsState => {
  const current = owedOf({ state, ...key })
  return current === null
    ? state
    : { ...state, owed: state.owed.filter((item) => item !== current) }
}

type SetSidecarsProps = WithState<{ downloadId: string; sidecars: readonly Sidecar[] }>

/** The subtitles a finished download keeps beside its video. */
export const setSidecars = ({ state, downloadId, sidecars }: SetSidecarsProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) =>
      entry.sidecars.length === 0 && sidecars.length === 0
        ? entry
        : { ...entry, sidecars: [...sidecars] },
  })

type SetLibraryProps = WithState<{
  downloadId: string
  library: DownloadLibrary
  titleItemId: number | null
}>

/** What the server said of an entry confirmed before its library and its title's item were kept. */
export const setLibrary = ({
  state,
  downloadId,
  library,
  titleItemId,
}: SetLibraryProps): DownloadsState =>
  changeEntry({ state, downloadId, change: (entry) => ({ ...entry, library, titleItemId }) })

type SetPicturesProps = WithState<{
  downloadIds: readonly string[]
  pictures: EntryPictures
}>

/** The pictures saved for a title or an album, on each of its entries. */
export const setPictures = ({ state, downloadIds, pictures }: SetPicturesProps): DownloadsState =>
  downloadIds.reduce(
    (changed, downloadId) =>
      changeEntry({ state: changed, downloadId, change: (entry) => ({ ...entry, pictures }) }),
    state,
  )

type SetAutoDeleteProps = WithState<{ downloadId: string; autoDelete: boolean; at: number }>

/**
 * Switching the option on for a title already watched moves an older `watchedAt` up to `at`:
 * from then on it says when the ten-minute clock counts from, so the switch never deletes at
 * once, not even at the next launch. Nothing else reads it as a time, only against null.
 */
export const setAutoDelete = ({
  state,
  downloadId,
  autoDelete,
  at,
}: SetAutoDeleteProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) => {
      if (entry.autoDelete === autoDelete) return entry
      const { watchedAt } = entry
      const isRestarted = autoDelete && watchedAt !== null && watchedAt < at
      return { ...entry, autoDelete, watchedAt: isRestarted ? at : watchedAt }
    },
  })

type SetAutoDeleteDefaultProps = WithState<{ autoDelete: boolean }>

export const setAutoDeleteDefault = ({
  state,
  autoDelete,
}: SetAutoDeleteDefaultProps): DownloadsState =>
  state.autoDeleteDefault === autoDelete ? state : { ...state, autoDeleteDefault: autoDelete }

type NoteWatchedProps = WithState<{
  downloadId: string
  position: number
  duration: number | null
  at: number
}>

/** Marks the first time playback reaches the library's Watched at; a later report never moves it. */
export const noteWatched = ({
  state,
  downloadId,
  position,
  duration,
  at,
}: NoteWatchedProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) => {
      const total = duration ?? entry.duration
      if (entry.watchedAt !== null || total === null || total <= 0) return entry
      return position / total >= entry.watchedPercent / 100 ? { ...entry, watchedAt: at } : entry
    },
  })

type ForgetServerPositionProps = WithState<{ downloadId: string }>

/** A position was noted here, so the server's resume spot no longer says where the file starts. */
export const forgetServerPosition = ({
  state,
  downloadId,
}: ForgetServerPositionProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) => (entry.serverPosition === 0 ? entry : { ...entry, serverPosition: 0 }),
  })

type NotePendingProps = WithState<{
  downloadId: string
  play: boolean
  position: number
  at: number
  accountId: string | null
}>

/**
 * `play` is sticky: a position report must not erase a play the server has not heard. `furthest`
 * only rises until a send clears it. What the entry held for another account moves to `owed`
 * first, so one account's report never folds into another's.
 */
export const notePending = ({
  state,
  downloadId,
  play,
  position,
  at,
  accountId,
}: NotePendingProps): DownloadsState => {
  const current = entryById({ state, downloadId })
  if (current === null) return state
  const isOtherAccount = hasPending(current) && current.pending.accountId !== accountId
  const owed = isOtherAccount ? owe({ state, entries: [current] }) : state.owed
  const before = isOtherAccount ? NO_PENDING : current.pending
  return changeEntry({
    state: { ...state, owed },
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
  })
}

type ClearPendingProps = WithState<Sent & { downloadId: string }>

/**
 * Clears what a sync sent. A position saved during the call differs from `sentPosition` and
 * stays, as a furthest raised during it differs from `sentFurthest`; a play is cleared only when
 * `sentPlay`, so one flagged by an open during a call that did not carry it stays too.
 */
export const clearPending = ({
  state,
  downloadId,
  sentPlay,
  sentPosition,
  sentFurthest,
}: ClearPendingProps): DownloadsState =>
  changeEntry({
    state,
    downloadId,
    change: (entry) => {
      const pending = clearedOf({ pending: entry.pending, sentPlay, sentPosition, sentFurthest })
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
