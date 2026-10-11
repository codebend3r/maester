import type {
  AudioTrack,
  Credit,
  CreditJob,
  DirectoryEntry,
  DirectoryListing,
  HistoryEntry,
  ImageOption,
  ItemDetails,
  ItemImageOptions,
  ItemMetadata,
  ItemMetadataChange,
  ItemMetadataState,
  ItemSummary,
  ItemType,
  Library,
  LibraryKind,
  LibrarySettings,
  LibraryView,
  LockState,
  MatchCandidate,
  MatchState,
  MediaGroupBy,
  MediaItem,
  MediaLocation,
  MediaSort,
  MediaTracks,
  MetadataHealth,
  MetadataServiceState,
  PersonDetails,
  PlaybackSettings,
  PlaybackSettingsState,
  Rating,
  RatingSource,
  Review,
  ScanStatus,
  ServerEvent,
  ShowEntry,
  ShowListing,
  ShownRatings,
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
  'changed',
  'largest',
  'smallest',
  'bitrate-high',
  'bitrate-low',
  'resolution-high',
  'resolution-low',
  'year-new',
  'year-old',
  'rating-high',
  'rating-low',
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

export const MEDIA_GROUPINGS: readonly MediaGroupBy[] = ['match', 'resolution', 'codec', 'month']

export const isMediaGroupBy = (value: unknown): value is MediaGroupBy =>
  MEDIA_GROUPINGS.some((grouping) => grouping === value)

export const SHOWN_RATINGS: readonly ShownRatings[] = [
  'tmdb',
  'imdb',
  'rottenTomatoes',
  'metacritic',
]

export const isShownRatings = (value: unknown): value is ShownRatings =>
  SHOWN_RATINGS.some((source) => source === value)

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
  isLibraryKind(value.kind) &&
  isShownRatings(value.ratingsSource) &&
  isBoolean(value.autoRefresh) &&
  isBoolean(value.locked)

export const isLibrary = (value: unknown): value is Library =>
  isRecord(value) &&
  isNumber(value.id) &&
  isString(value.name) &&
  isStringArray(value.paths) &&
  isNumber(value.itemCount) &&
  isNumber(value.unmatchedCount) &&
  isString(value.createdAt) &&
  isScanStatus(value.scan) &&
  isLibrarySettings(value.settings)

export const isLibraryList = arrayOf(isLibrary)

const THUMBNAIL_STATES: readonly ThumbnailState[] = ['pending', 'ready', 'failed']

export const isThumbnailState = (value: unknown): value is ThumbnailState =>
  THUMBNAIL_STATES.some((state) => state === value)

const MATCH_STATES: readonly MatchState[] = ['pending', 'matched', 'manual', 'unmatched', 'off']

export const isMatchState = (value: unknown): value is MatchState =>
  MATCH_STATES.some((state) => state === value)

const ITEM_TYPES: readonly ItemType[] = ['movie', 'show', 'season', 'episode']

export const isItemType = (value: unknown): value is ItemType =>
  ITEM_TYPES.some((type) => type === value)

const RATING_SOURCES: readonly RatingSource[] = ['tmdb', 'imdb', 'rottenTomatoes', 'metacritic']

export const isRatingSource = (value: unknown): value is RatingSource =>
  RATING_SOURCES.some((source) => source === value)

export const isRating = (value: unknown): value is Rating =>
  isRecord(value) &&
  isRatingSource(value.source) &&
  (value.kind === 'critic' || value.kind === 'audience') &&
  isNumber(value.value) &&
  isNullableNumber(value.votes)

export const isItemSummary = (value: unknown): value is ItemSummary =>
  isRecord(value) &&
  isNumber(value.id) &&
  isItemType(value.type) &&
  isString(value.title) &&
  isNullableNumber(value.year) &&
  (value.show === null ||
    (isRecord(value.show) && isNumber(value.show.id) && isString(value.show.title))) &&
  isNullableNumber(value.season) &&
  isNullableNumber(value.episode) &&
  isNullableString(value.posterVersion) &&
  arrayOf(isRating)(value.ratings)

export const isItemSummaryList = arrayOf(isItemSummary)

export const isReview = (value: unknown): value is Review =>
  isRecord(value) &&
  isNumber(value.id) &&
  isString(value.author) &&
  isNullableString(value.avatarVersion) &&
  isNullableNumber(value.rating) &&
  isString(value.content) &&
  isString(value.url) &&
  isString(value.writtenAt)

const CREDIT_JOBS: readonly CreditJob[] = [
  'cast',
  'guest',
  'director',
  'writer',
  'creator',
  'producer',
]

export const isCreditJob = (value: unknown): value is CreditJob =>
  CREDIT_JOBS.some((job) => job === value)

export const isCredit = (value: unknown): value is Credit =>
  isRecord(value) &&
  isNumber(value.personId) &&
  isString(value.name) &&
  isCreditJob(value.job) &&
  isNullableString(value.role) &&
  isNullableString(value.photoVersion)

export const isMatchCandidate = (value: unknown): value is MatchCandidate =>
  isRecord(value) &&
  isString(value.tmdbId) &&
  isString(value.title) &&
  isNullableNumber(value.year) &&
  isNullableString(value.overview) &&
  isNullableString(value.poster)

export const isMatchCandidateList = arrayOf(isMatchCandidate)

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  directPlay: 'auto',
  transcoding: 'on',
  maxHeight: 1080,
  quality: 'medium',
  hwAccel: 'auto',
  tonemap: true,
}

export const isPlaybackSettings = (value: unknown): value is PlaybackSettings =>
  isRecord(value) &&
  (value.directPlay === 'auto' || value.directPlay === 'force') &&
  (value.transcoding === 'on' ||
    value.transcoding === 'remuxOnly' ||
    value.transcoding === 'off') &&
  (value.maxHeight === 2160 || value.maxHeight === 1080 || value.maxHeight === 720) &&
  (value.quality === 'low' || value.quality === 'medium' || value.quality === 'high') &&
  (value.hwAccel === 'auto' ||
    value.hwAccel === 'none' ||
    value.hwAccel === 'vaapi' ||
    value.hwAccel === 'videotoolbox') &&
  isBoolean(value.tonemap)

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isPlaybackSettingsChange = (value: unknown): value is Partial<PlaybackSettings> =>
  isRecord(value) &&
  Object.keys(value).every((key) => key in DEFAULT_PLAYBACK_SETTINGS) &&
  isPlaybackSettings({ ...DEFAULT_PLAYBACK_SETTINGS, ...value })

export const isPlaybackSettingsState = (value: unknown): value is PlaybackSettingsState =>
  isRecord(value) &&
  isPlaybackSettings(value.settings) &&
  isRecord(value.effective) &&
  (value.effective.encoder === 'software' ||
    value.effective.encoder === 'vaapi' ||
    value.effective.encoder === 'videotoolbox') &&
  isBoolean(value.effective.tonemapAvailable)

const METADATA_FIELDS: readonly (keyof ItemMetadata)[] = [
  'title',
  'year',
  'tagline',
  'summary',
  'contentRating',
]

export const isItemMetadata = (value: unknown): value is ItemMetadata =>
  isRecord(value) &&
  isString(value.title) &&
  isNullableNumber(value.year) &&
  isNullableString(value.tagline) &&
  isNullableString(value.summary) &&
  isNullableString(value.contentRating)

export const isItemMetadataState = (value: unknown): value is ItemMetadataState =>
  isRecord(value) &&
  isItemMetadata(value.shown) &&
  isItemMetadata(value.original) &&
  Array.isArray(value.overridden) &&
  value.overridden.every((field) => METADATA_FIELDS.some((known) => known === field))

/** Only known fields, each text, a number for the year, or null; nothing else. */
export const isItemMetadataChange = (value: unknown): value is ItemMetadataChange =>
  isRecord(value) &&
  Object.keys(value).every((key) => METADATA_FIELDS.some((known) => known === key)) &&
  (value.title === undefined || isNullableString(value.title)) &&
  (value.year === undefined || isNullableNumber(value.year)) &&
  (value.tagline === undefined || isNullableString(value.tagline)) &&
  (value.summary === undefined || isNullableString(value.summary)) &&
  (value.contentRating === undefined || isNullableString(value.contentRating))

export const isImageOption = (value: unknown): value is ImageOption =>
  isRecord(value) &&
  (value.source === 'local' || value.source === 'tmdb') &&
  isString(value.ref) &&
  isNullableNumber(value.width) &&
  isNullableNumber(value.height) &&
  isNullableString(value.language) &&
  isBoolean(value.current)

export const isItemImageOptions = (value: unknown): value is ItemImageOptions =>
  isRecord(value) && arrayOf(isImageOption)(value.poster) && arrayOf(isImageOption)(value.backdrop)

const isServiceState = (value: unknown): value is MetadataServiceState =>
  value === 'off' || value === 'ok' || value === 'failing'

export const isMetadataHealth = (value: unknown): value is MetadataHealth =>
  isRecord(value) &&
  isServiceState(value.tmdb) &&
  isServiceState(value.omdb) &&
  isNumber(value.pending) &&
  isNullableString(value.error) &&
  isNullableString(value.lastOk)

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
  isString(value.addedAt) &&
  isString(value.changedAt) &&
  isMatchState(value.match) &&
  isNullableNumber(value.year) &&
  isNullableString(value.edition) &&
  (value.item === null || isItemSummary(value.item)) &&
  isNumber(value.versions)

export const isMediaList = arrayOf(isMediaItem)

export const isMediaLocation = (value: unknown): value is MediaLocation =>
  isRecord(value) && isString(value.path)

export const isLockState = (value: unknown): value is LockState =>
  isRecord(value) && isBoolean(value.available) && isBoolean(value.unlocked)

export const isServerEvent = (value: unknown): value is ServerEvent =>
  isRecord(value) && value.type === 'library' && isNumber(value.libraryId)

export const isPersonDetails = (value: unknown): value is PersonDetails =>
  isRecord(value) &&
  isNumber(value.id) &&
  isString(value.name) &&
  isNullableString(value.photoVersion) &&
  arrayOf(
    (credit): credit is PersonDetails['credits'][number] =>
      isRecord(credit) &&
      isItemSummary(credit.item) &&
      isCreditJob(credit.job) &&
      isNullableString(credit.role),
  )(value.credits)

export const isShowEntry = (value: unknown): value is ShowEntry =>
  isRecord(value) &&
  isItemSummary(value.show) &&
  isNumber(value.episodes) &&
  isNullableNumber(value.endedYear) &&
  isString(value.addedAt) &&
  (value.next === null || isMediaItem(value.next))

export const isShowListing = (value: unknown): value is ShowListing =>
  isRecord(value) && arrayOf(isShowEntry)(value.shows) && isMediaList(value.unmatched)

export const isItemDetails = (value: unknown): value is ItemDetails =>
  isRecord(value) &&
  isString(value.tmdbId) &&
  isNullableString(value.imdbId) &&
  isNullableString(value.originalTitle) &&
  isNullableString(value.tagline) &&
  isNullableString(value.summary) &&
  isNullableString(value.contentRating) &&
  isNullableString(value.released) &&
  isNullableString(value.ended) &&
  isNullableNumber(value.runtime) &&
  isNullableString(value.studio) &&
  isStringArray(value.genres) &&
  isNullableString(value.backdropVersion) &&
  arrayOf(isCredit)(value.credits) &&
  arrayOf(isReview)(value.reviews) &&
  isMediaList(value.versions) &&
  isItemSummaryList(value.children) &&
  isItemSummary(value)

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
