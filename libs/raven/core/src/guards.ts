import type {
  AudioTrack,
  DirectoryEntry,
  DirectoryListing,
  HistoryEntry,
  Library,
  LibraryKind,
  LibrarySettings,
  LibraryView,
  MediaGroupBy,
  MediaItem,
  MediaSort,
  MediaTracks,
  ScanStatus,
  SubtitleTrack,
  ThumbnailState,
} from '@/types'

/**
 * Type guards for everything that crosses the network. `response.json()` and
 * a request body are both `unknown` until one of these says otherwise, which
 * is what lets every client and the server skip casts entirely.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isString = (value: unknown): value is string => typeof value === 'string'

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

export const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value)

export const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value)

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

/** A guard for a list whose every entry passes `guard`. */
const arrayOf =
  <T>(guard: (item: unknown) => item is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(guard)

export const isScanStatus = (value: unknown): value is ScanStatus =>
  isRecord(value) &&
  (value.state === 'idle' || value.state === 'scanning') &&
  isNumber(value.discovered) &&
  isNumber(value.processed) &&
  isNullableString(value.startedAt) &&
  isNullableString(value.finishedAt) &&
  isNullableString(value.error)

export const MEDIA_SORTS: readonly MediaSort[] = [
  'title',
  'added',
  'oldest',
  'largest',
  'smallest',
  'bitrate-high',
  'bitrate-low',
  'resolution-high',
  'resolution-low',
  'random',
]

export const isMediaSort = (value: unknown): value is MediaSort =>
  MEDIA_SORTS.some((sort) => sort === value)

export const LIBRARY_VIEWS: readonly LibraryView[] = ['grid', 'list', 'tiles', 'grouped']

export const isLibraryView = (value: unknown): value is LibraryView =>
  LIBRARY_VIEWS.some((view) => view === value)

export const LIBRARY_KINDS: readonly LibraryKind[] = ['movies', 'shows', 'other']

export const isLibraryKind = (value: unknown): value is LibraryKind =>
  LIBRARY_KINDS.some((kind) => kind === value)

export const MEDIA_GROUPINGS: readonly MediaGroupBy[] = ['resolution', 'codec', 'month']

export const isMediaGroupBy = (value: unknown): value is MediaGroupBy =>
  MEDIA_GROUPINGS.some((grouping) => grouping === value)

/** A whole percentage from 1 to 100. */
export const isWatchedPercent = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1 && value <= 100

export const isLibrarySettings = (value: unknown): value is LibrarySettings =>
  isRecord(value) &&
  isBoolean(value.saveProgress) &&
  isBoolean(value.pinned) &&
  isMediaSort(value.sort) &&
  isLibraryView(value.view) &&
  isMediaGroupBy(value.groupBy) &&
  isWatchedPercent(value.watchedPercent) &&
  isLibraryKind(value.kind)

export const isLibrary = (value: unknown): value is Library =>
  isRecord(value) &&
  isNumber(value.id) &&
  isString(value.name) &&
  isStringArray(value.paths) &&
  isNumber(value.itemCount) &&
  isString(value.createdAt) &&
  isScanStatus(value.scan) &&
  isLibrarySettings(value.settings)

export const isLibraryList = arrayOf(isLibrary)

const THUMBNAIL_STATES: readonly ThumbnailState[] = ['pending', 'ready', 'failed']

export const isThumbnailState = (value: unknown): value is ThumbnailState =>
  THUMBNAIL_STATES.some((state) => state === value)

export const isMediaItem = (value: unknown): value is MediaItem =>
  isRecord(value) &&
  isNumber(value.id) &&
  isNumber(value.libraryId) &&
  isString(value.title) &&
  isString(value.fileName) &&
  isString(value.folder) &&
  isNumber(value.size) &&
  isString(value.container) &&
  isNullableNumber(value.duration) &&
  isNullableNumber(value.width) &&
  isNullableNumber(value.height) &&
  isNullableString(value.videoCodec) &&
  isNullableNumber(value.videoBitDepth) &&
  typeof value.hdr === 'boolean' &&
  isNullableString(value.audioCodec) &&
  isNullableNumber(value.audioChannels) &&
  isNullableNumber(value.bitrate) &&
  isThumbnailState(value.thumbnail) &&
  isNumber(value.thumbnailVersion) &&
  isNumber(value.position) &&
  typeof value.favourite === 'boolean' &&
  isString(value.addedAt)

export const isMediaList = arrayOf(isMediaItem)

export const isHistoryEntry = (value: unknown): value is HistoryEntry =>
  isRecord(value) &&
  isMediaItem(value.media) &&
  isString(value.lastPlayedAt) &&
  isNumber(value.plays) &&
  isNumber(value.furthest) &&
  isBoolean(value.watched)

export const isHistory = arrayOf(isHistoryEntry)

export const isDirectoryListing = (value: unknown): value is DirectoryListing =>
  isRecord(value) &&
  isString(value.path) &&
  isNullableString(value.parent) &&
  arrayOf(
    (entry): entry is DirectoryEntry =>
      isRecord(entry) && isString(entry.name) && isString(entry.path),
  )(value.directories)

export const isAudioTrack = (value: unknown): value is AudioTrack =>
  isRecord(value) &&
  isNumber(value.index) &&
  isNullableString(value.codec) &&
  isNullableNumber(value.channels) &&
  isNullableString(value.language) &&
  isNullableString(value.title) &&
  isBoolean(value.default)

export const isSubtitleTrack = (value: unknown): value is SubtitleTrack =>
  isRecord(value) &&
  isString(value.id) &&
  (value.source === 'embedded' || value.source === 'external') &&
  isNullableString(value.codec) &&
  isNullableString(value.language) &&
  isNullableString(value.title) &&
  isBoolean(value.default) &&
  isBoolean(value.forced) &&
  isBoolean(value.hearingImpaired) &&
  isBoolean(value.supported)

export const isMediaTracks = (value: unknown): value is MediaTracks =>
  isRecord(value) &&
  arrayOf(isAudioTrack)(value.audio) &&
  arrayOf(isSubtitleTrack)(value.subtitles) &&
  isNullableNumber(value.defaultAudio) &&
  isNullableNumber(value.frameRate)
