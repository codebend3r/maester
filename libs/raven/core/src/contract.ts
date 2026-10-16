import {
  type Guard,
  type Infer,
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  listOf,
  keyOf,
  nullable,
  object,
  oneOf,
  union,
  exactPartial,
} from '@/schema'
import { MAX_WATCH_TARGETS } from '@/watched'

/**
 * The API contract between the media server and every client. Anything a
 * client renders, or the server returns, is one of these shapes, so the web
 * app and a future native app agree on the wire format by construction.
 *
 * Each shape is written once, as the guard that checks it, and its type is
 * read off the guard. `response.json()` and a request body are both
 * `unknown` until one of these says otherwise, which is what lets every
 * client and the server skip casts entirely.
 */

/**
 * A scan first walks the library's paths for videos, then indexes what it
 * found; `idle` between scans.
 */
export const isScanState = oneOf(['idle', 'walking', 'indexing'])

export type ScanState = Infer<typeof isScanState>

export const isScanStatus = object({
  state: isScanState,
  /**
   * Video files found under the library's paths: climbing while the walk
   * looks, as a big share takes minutes, then all of them.
   */
  found: isNumber,
  /** Files already indexed: unchanged ones count straight away, new and changed ones once probed. */
  processed: isNumber,
  startedAt: nullable(isString),
  finishedAt: nullable(isString),
  /** The last scan's failure, cleared when the next scan starts. */
  error: nullable(isString),
})

export type ScanStatus = Infer<typeof isScanStatus>

/** Whether a scan is under way, walking or indexing. */
export const isScanning = (scan: ScanStatus): boolean => scan.state !== 'idle'

export const SORT_DIRECTIONS = ['ascending', 'descending'] as const

export type SortDirection = (typeof SORT_DIRECTIONS)[number]

/** Every field a library can be sorted on, in the order a menu offers them. */
export const isSortFieldName = oneOf([
  'title',
  'added',
  'changed',
  'size',
  'bitrate',
  'resolution',
  'release',
  'rating',
  'random',
])

export type SortFieldName = Infer<typeof isSortFieldName>

/**
 * What a listing is sorted on, each field with its sorts: one for each way a
 * field runs and the way it starts, or the one sort of a field with no way
 * to it. Ascending runs A to Z, oldest, smallest or lowest first; a field
 * starts the way it is most often wanted, newest or biggest first but for
 * titles. `changed` puts the files last found, renamed, moved or replaced
 * first. Resolution ranks by pixel count. `random` shuffles by a seed the
 * client sends, so the order holds across refetches until it deals a new one.
 */
export const SORT_FIELDS = {
  title: { type: 'directed', ascending: 'title', descending: 'title-desc', start: 'ascending' },
  added: { type: 'directed', ascending: 'oldest', descending: 'added', start: 'descending' },
  changed: {
    type: 'directed',
    ascending: 'changed-old',
    descending: 'changed',
    start: 'descending',
  },
  size: { type: 'directed', ascending: 'smallest', descending: 'largest', start: 'descending' },
  bitrate: {
    type: 'directed',
    ascending: 'bitrate-low',
    descending: 'bitrate-high',
    start: 'descending',
  },
  resolution: {
    type: 'directed',
    ascending: 'resolution-low',
    descending: 'resolution-high',
    start: 'descending',
  },
  release: { type: 'directed', ascending: 'year-old', descending: 'year-new', start: 'descending' },
  rating: {
    type: 'directed',
    ascending: 'rating-low',
    descending: 'rating-high',
    start: 'descending',
  },
  random: { type: 'undirected', sort: 'random' },
} as const satisfies Record<
  SortFieldName,
  | { type: 'directed'; ascending: string; descending: string; start: SortDirection }
  | { type: 'undirected'; sort: string }
>

type SortFieldRule = (typeof SORT_FIELDS)[SortFieldName]

/** Every sort the table names, read off it; `MediaSort` is the same union, read off its guard. */
type FieldSort =
  | Extract<SortFieldRule, { type: 'directed' }>[SortDirection]
  | Extract<SortFieldRule, { type: 'undirected' }>['sort']

/** A field's sorts: one for each way it runs, or the one of a field with no way to it. */
export const fieldSorts = (name: SortFieldName): FieldSort[] => {
  const field: SortFieldRule = SORT_FIELDS[name]
  return field.type === 'directed' ? [field.ascending, field.descending] : [field.sort]
}

/** Every sort of every field in `SORT_FIELDS`, which is the one place a sort is named. */
export const isMediaSort = oneOf(isSortFieldName.values.flatMap(fieldSorts))

export type MediaSort = Infer<typeof isMediaSort>

export const MEDIA_SORTS = isMediaSort.values

export const isLibraryView = oneOf(['grid', 'list', 'tiles', 'grouped'])

export type LibraryView = Infer<typeof isLibraryView>

export const LIBRARY_VIEWS = isLibraryView.values

export const isLibraryKind = oneOf([
  'movies',
  'shows',
  'animeMovies',
  'animeShows',
  'familyMovies',
  'familyShows',
  'documentaries',
  'sports',
  'youtube',
  'other',
])

export type LibraryKind = Infer<typeof isLibraryKind>

export const LIBRARY_KINDS = isLibraryKind.values

/**
 * The icons a library can wear, in the order Edit library offers them:
 * films and shows, then sport, then audio. Each type wears one of them
 * until its library picks another; the web app draws them.
 */
export const isLibraryIconName = oneOf([
  'film',
  'tv',
  'filmSpark',
  'tvSpark',
  'filmHeart',
  'tvHeart',
  'globe',
  'tvGlobe',
  'fourK',
  'musicVideo',
  'youtube',
  'video',
  'standUp',
  'gamepad',
  'trophy',
  'octagon',
  'basketball',
  'soccer',
  'americanFootball',
  'headphones',
  'music',
  'disc',
  'podcast',
  'audiobook',
])

export type LibraryIconName = Infer<typeof isLibraryIconName>

export const LIBRARY_ICON_NAMES = isLibraryIconName.values

export const isMediaGroupBy = oneOf(['match', 'resolution', 'codec', 'month'])

/** `match` buckets a matched library, of movies or shows, by how far matching got. */
export type MediaGroupBy = Infer<typeof isMediaGroupBy>

export const MEDIA_GROUPINGS = isMediaGroupBy.values

export const isRatingSource = oneOf(['tmdb', 'imdb', 'rottenTomatoes', 'metacritic'])

export type RatingSource = Infer<typeof isRatingSource>

export const RATING_SOURCES = isRatingSource.values

/**
 * How a library's folders are read: `auto` reads letter folders (`A/`, `#/`)
 * and group folders (`Requests/`) as holding the titles; `flat` reads every
 * top folder as one title.
 */
export const isFolderLayout = oneOf(['auto', 'flat'])

export type FolderLayout = Infer<typeof isFolderLayout>

export const FOLDER_LAYOUTS = isFolderLayout.values

/** What a library path turned out to be on its last full scan. */
export const isPathLayout = oneOf(['flat', 'lettered', 'grouped'])

export type PathLayout = Infer<typeof isPathLayout>

/** One library path, how it was read, and how many group folders it holds. */
export const isLibraryPathLayout = object({
  path: isString,
  /** null until a full scan has read the path. */
  layout: nullable(isPathLayout),
  groups: isNumber,
})

export type LibraryPathLayout = Infer<typeof isLibraryPathLayout>

/** A whole percentage from 1 to 100. */
export const isWatchedPercent = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1 && value <= 100

/** How a library behaves, each one set per library. */
export const isLibrarySettings = object({
  /** Remember where each video stopped and resume there. Off keeps saved spots without using them. */
  saveProgress: isBoolean,
  /** Give the library its own link in the side menu. */
  pinned: isBoolean,
  /** The order its videos are listed in. */
  sort: isMediaSort,
  /** How its videos are laid out: cards, a table, tiles, or cards in groups. */
  view: isLibraryView,
  /** What the grouped view buckets videos by. */
  groupBy: isMediaGroupBy,
  /** How far into a video, as a whole percentage, a play must get for it to count as watched. */
  watchedPercent: isWatchedPercent,
  /** What the library holds: movies, TV shows, anime movies or shows, sporting events, YouTube videos, or anything else. */
  kind: isLibraryKind,
  /** Whose score its cards show and its rating sorts use; TMDB's stands in where that source has none. */
  ratingsSource: isRatingSource,
  /** Watch the folders and take in videos added, removed, renamed or replaced there as it happens. */
  autoRefresh: isBoolean,
  /** Private, whatever its type: its videos stay hidden until the server's PIN is entered. */
  locked: isBoolean,
  /** Read letter and group folders as holding the titles (`auto`), or every top folder as one title (`flat`). */
  folderLayout: isFolderLayout,
  /** The icon it wears in the side menu, on its page and on Libraries; null wears its type's. */
  icon: nullable(isLibraryIconName),
})

export type LibrarySettings = Infer<typeof isLibrarySettings>

/** Some of a library's settings, each a value it takes, and nothing else. */
export const isLibrarySettingsChange = exactPartial(isLibrarySettings.shape)

/**
 * How a library is laid out, and its pin: the settings any viewer may
 * change, with the admin lock on or off. Everything else of a library, its
 * name and folders included, is an admin's `LibraryInput`.
 */
export const isLibraryViewChange = exactPartial({
  sort: isLibrarySettings.shape.sort,
  view: isLibrarySettings.shape.view,
  groupBy: isLibrarySettings.shape.groupBy,
  pinned: isLibrarySettings.shape.pinned,
})

export type LibraryViewChange = Infer<typeof isLibraryViewChange>

/**
 * The picture that stands for a library's newest video: the backdrop of its
 * movie or show (an episode's comes from its show), else the video's own
 * thumbnail. `item` names the movie or show, `thumbnail` the video.
 */
export const isLibraryBackdrop = union(
  object({ type: oneOf(['item']), id: isNumber, version: isString }),
  object({ type: oneOf(['thumbnail']), id: isNumber, version: isNumber }),
)

export type LibraryBackdrop = Infer<typeof isLibraryBackdrop>

export const isLibrary = object({
  id: isNumber,
  name: isString,
  /**
   * Absolute folder paths as the server sees them (container paths under
   * Docker). None while the library is locked to this browser.
   */
  paths: isStringArray,
  /** How each path was read on its last full scan, in path order. None while the library is locked to this browser. */
  layouts: listOf(isLibraryPathLayout),
  itemCount: isNumber,
  /** Files no movie or show was found for; 0 in a library that is not matched. */
  unmatchedCount: isNumber,
  createdAt: isString,
  /** While the library is locked to this browser, a failure says only that there was one. */
  scan: isScanStatus,
  settings: isLibrarySettings,
  /** null when no video has a picture yet, or while the library is locked to this browser. */
  backdrop: nullable(isLibraryBackdrop),
})

export type Library = Infer<typeof isLibrary>

export const isLibraryList = listOf(isLibrary)

/**
 * What a client sends to create a library or replace its name and paths.
 * Settings left out keep their defaults on create and their current values
 * on update, so a client can change one without knowing the rest.
 * `validateLibraryInput` checks it, with a reason for each problem.
 */
export type LibraryInput = {
  name: string
  paths: string[]
  settings?: Partial<LibrarySettings>
}

export const isThumbnailState = oneOf(['pending', 'ready', 'failed'])

export type ThumbnailState = Infer<typeof isThumbnailState>

export const isMatchState = oneOf(['pending', 'matched', 'manual', 'unmatched', 'off'])

/**
 * `pending` waits for matching, `matched` found its item by itself,
 * `manual` was chosen with Fix match, `unmatched` found nothing sure, and
 * `off` is a library that is not matched, or an extra.
 */
export type MatchState = Infer<typeof isMatchState>

export const isItemType = oneOf(['movie', 'show', 'season', 'episode'])

export type ItemType = Infer<typeof isItemType>

/** What Fix match and matching look files up as on TMDB, and what Edit images chooses pictures for. */
export const isMatchItemType = oneOf(['movie', 'show'] satisfies ItemType[])

export type MatchItemType = Infer<typeof isMatchItemType>

export const isRating = object({
  source: isRatingSource,
  /** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
  kind: oneOf(['critic', 'audience']),
  /** Out of 10. */
  value: isNumber,
  votes: nullable(isNumber),
})

export type Rating = Infer<typeof isRating>

/** What a card needs to show a movie, show, season or episode. */
export const isItemSummary = object({
  id: isNumber,
  type: isItemType,
  title: isString,
  year: nullable(isNumber),
  /** For seasons and episodes: the show they belong to. */
  show: nullable(object({ id: isNumber, title: isString })),
  season: nullable(isNumber),
  episode: nullable(isNumber),
  /** Changes whenever the poster does; null when there is none. */
  posterVersion: nullable(isString),
  /**
   * Changes whenever the backdrop does; null when there is none. A season or
   * an episode has none of its own here.
   */
  backdropVersion: nullable(isString),
  /** Every score it has, one per source. */
  ratings: listOf(isRating),
})

export type ItemSummary = Infer<typeof isItemSummary>

export const isMediaItem = object({
  id: isNumber,
  libraryId: isNumber,
  title: isString,
  fileName: isString,
  /** The folder the file sits in, under the folder its titles sit in (its library path, or a letter or group folder there); '' there. */
  folder: isString,
  size: isNumber,
  /** Normalised from the file extension: 'mp4', 'mkv', 'webm', 'mov', ... */
  container: isString,
  /** Seconds, or null until the file has been probed. */
  duration: nullable(isNumber),
  width: nullable(isNumber),
  height: nullable(isNumber),
  /** ffprobe codec names: 'h264', 'hevc', 'vp9', 'av1', ... */
  videoCodec: nullable(isString),
  videoBitDepth: nullable(isNumber),
  hdr: isBoolean,
  /** ffprobe codec names: 'aac', 'ac3', 'eac3', 'opus', 'truehd', ... */
  audioCodec: nullable(isString),
  audioChannels: nullable(isNumber),
  /** Bits per second across the whole file. */
  bitrate: nullable(isNumber),
  thumbnail: isThumbnailState,
  /** Changes whenever the file does, so a thumbnail URL can be cached forever. */
  thumbnailVersion: isNumber,
  /** Where playback last stopped, in seconds; 0 when never started or finished. */
  position: isNumber,
  favourite: isBoolean,
  /** Whether its card is watched: any of the files on it has a mark, or a play that got to the library's watched percentage. */
  watched: isBoolean,
  addedAt: isString,
  /** When the file last changed on disk: found, renamed, moved or replaced. */
  changedAt: isString,
  /** How far matching got: see `MatchState`. */
  match: isMatchState,
  /** The year the name gives, in a matched library; null elsewhere. */
  year: nullable(isNumber),
  /** Plex's `{edition-...}` from the name. */
  edition: nullable(isString),
  /** The movie or episode this file is, once matched. */
  item: nullable(isItemSummary),
  /**
   * How many files in its library share its card, this one included: the
   * movie's files, or those of its cut once split apart; 1 for anything else.
   */
  versions: isNumber,
  /**
   * What sets its card apart from the movie's others once its files were
   * split apart: its cut, `Final Cut`, else what its name says past the
   * title, `WEBDL-2160p`. Null while it shares the movie's own card, and
   * for anything but a movie.
   */
  variant: nullable(isString),
  /**
   * Which of its movie's cards in its library it sits on once split apart,
   * the same for every file on that card; null on the movie's own card, and
   * for anything but a movie.
   */
  card: nullable(isString),
})

export type MediaItem = Infer<typeof isMediaItem>

export const isMediaList = listOf(isMediaItem)

export const isCreditJob = oneOf(['cast', 'guest', 'director', 'writer', 'creator', 'producer'])

export type CreditJob = Infer<typeof isCreditJob>

export const isCredit = object({
  personId: isNumber,
  name: isString,
  job: isCreditJob,
  /** The character, or the job in full: "Screenplay", "Novel". */
  role: nullable(isString),
  photoVersion: nullable(isString),
})

export type Credit = Infer<typeof isCredit>

/** A review by a TMDB member, as TMDB hands it on. */
export const isReview = object({
  id: isNumber,
  author: isString,
  /** Changes with the avatar; null when TMDB hosts none. */
  avatarVersion: nullable(isString),
  /** Out of 10, when the author gave one. */
  rating: nullable(isNumber),
  /** Plain text; never rendered as HTML. */
  content: isString,
  /** The review on TMDB. */
  url: isString,
  writtenAt: isString,
})

export type Review = Infer<typeof isReview>

/** A season on its show's page: its card, and how many of its episodes are on disk. */
export const isSeasonSummary = object({
  ...isItemSummary.shape,
  type: oneOf(['season']),
  /** Its episodes with a file this browser may see. */
  episodeCount: isNumber,
  /** Of `episodeCount`, those watched. */
  watchedCount: isNumber,
})

export type SeasonSummary = Infer<typeof isSeasonSummary>

/** An episode on its season's page: what its row shows, and the file Play starts. */
export const isEpisodeSummary = object({
  ...isItemSummary.shape,
  type: oneOf(['episode']),
  summary: nullable(isString),
  released: nullable(isString),
  /** Minutes, from TMDB; the row prefers the file's own length. */
  runtime: nullable(isNumber),
  /** Changes whenever the still does, beside the file or TMDB's; null when there is none. */
  stillVersion: nullable(isString),
  /** Whether any of its files this browser may see is watched; not read off `primary`, whose card for a two-episode file is the first episode's. */
  watched: isBoolean,
  /** The version Play starts, by `primaryVersion`; null when none of its files may be seen. */
  primary: nullable(isMediaItem),
})

export type EpisodeSummary = Infer<typeof isEpisodeSummary>

/** A show's season or a season's episode, as its parent's page lists it. */
export const isItemChild = union(isSeasonSummary, isEpisodeSummary)

export type ItemChild = Infer<typeof isItemChild>

/** Why the AI lookup matched a movie or show it was sure of, in Claude's words. */
export const isAiMatch = object({ reason: isString })

export type AiMatch = Infer<typeof isAiMatch>

/** Everything a movie, show, season or episode page shows. */
export const isItemDetails = object({
  ...isItemSummary.shape,
  tmdbId: isString,
  imdbId: nullable(isString),
  originalTitle: nullable(isString),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
  released: nullable(isString),
  ended: nullable(isString),
  /** Minutes, from TMDB; pages prefer the file's own length. */
  runtime: nullable(isNumber),
  studio: nullable(isString),
  genres: isStringArray,
  /** The backdrop's version; for an episode, its still's. */
  backdropVersion: nullable(isString),
  /** The title as TMDB's art, on a clear ground; null when it has none, and for anything but a movie. */
  logoVersion: nullable(isString),
  /**
   * Why the AI lookup matched it, when it did, being sure; null when a
   * search, an id or Fix match did, and for a season or episode.
   */
  aiMatch: nullable(isAiMatch),
  credits: listOf(isCredit),
  /** Reviews by TMDB members, newest first; at most ten. */
  reviews: listOf(isReview),
  /** Every file that is this item, in any library, best first. */
  versions: isMediaList,
  /** A show's seasons, or a season's episodes, on disk, in order; none for a movie or episode. */
  children: listOf(isItemChild),
})

export type ItemDetails = Infer<typeof isItemDetails>

/** A show in a TV shows library's listing. */
export const isShowEntry = object({
  show: isItemSummary,
  /** Distinct episodes on disk. */
  episodes: isNumber,
  /** Of `episodes`, those watched. */
  watchedEpisodes: isNumber,
  /** The year the show ended, or null while it still airs. */
  endedYear: nullable(isNumber),
  /** When its newest file arrived. */
  addedAt: isString,
  /**
   * The mean bitrate of its files in the library, in bits per second, which
   * the bitrate sorts go by; null until one of them is probed.
   */
  bitrate: nullable(isNumber),
  /** The first episode not yet watched by the library's measure, or null when every one is. */
  next: nullable(isMediaItem),
})

export type ShowEntry = Infer<typeof isShowEntry>

/** A TV shows library: its shows, and the files no show was found for. */
export const isShowListing = object({
  shows: listOf(isShowEntry),
  unmatched: isMediaList,
})

export type ShowListing = Infer<typeof isShowListing>

/**
 * A library's row on the home page: a pinned library's newest arrivals,
 * newest first, or what a search found in it, by title. A TV shows library
 * gives its shows; any other library gives its videos.
 */
export const isHomeShelf = union(
  object({ libraryId: isNumber, type: oneOf(['shows']), shows: listOf(isShowEntry) }),
  object({ libraryId: isNumber, type: oneOf(['media']), media: isMediaList }),
)

export type HomeShelf = Infer<typeof isHomeShelf>

/**
 * A video, and the item whose poster its card shows: the movie, or an
 * episode's season (else its show); null for a file matched to none.
 */
export const isPosterEntry = object({ media: isMediaItem, poster: nullable(isItemSummary) })

export type PosterEntry = Infer<typeof isPosterEntry>

/**
 * `GET /api/favourites`: every favourite with its poster, most recently
 * marked first. A library's own favourites and videos in progress come the
 * same way.
 */
export const isPosterEntries = listOf(isPosterEntry)

/** How a saga's slideshow moves from one movie's backdrop to the next. */
export const isSlideshowMotion = oneOf(['fade', 'kenBurns', 'slide'])

export type SlideshowMotion = Infer<typeof isSlideshowMotion>

/**
 * What a saga's page shows behind its title: its movies' backdrops in turn,
 * first to last and round again, or the one of them picked, held still.
 * `PUT /api/libraries/:id/sagas/:sagaId/backdrop` takes it and answers with it.
 */
export const isSagaBackdrop = union(
  object({ type: oneOf(['slideshow']), motion: isSlideshowMotion }),
  object({ type: oneOf(['still']), itemId: isNumber }),
)

export type SagaBackdrop = Infer<typeof isSagaBackdrop>

/** A saga's backdrop until its library picks another. */
export const DEFAULT_SAGA_BACKDROP: SagaBackdrop = { type: 'slideshow', motion: 'fade' }

/**
 * A saga: a TMDB collection (The Lord of the Rings Collection, say) and the
 * movies of it a library holds, oldest first, one entry each, its best file.
 * The pictures its backdrop shows are read off them by `sagaPictures`.
 */
export const isSaga = object({
  tmdbId: isString,
  name: isString,
  backdrop: isSagaBackdrop,
  media: isMediaList,
})

export type Saga = Infer<typeof isSaga>

/** `GET /api/libraries/:id/sagas`: a library's sagas of two movies or more, by name. */
export const isSagaList = listOf(isSaga)

/** Which cut of a movie a file is, as its name reads. */
export const isFileCut = object({
  /** The cut in the name's own words: `Revisited the Final Cut`. */
  label: isString,
  /** The cut folded, so two namings of one cut agree: `revisited final`. */
  key: isString,
})

export type FileCut = Infer<typeof isFileCut>

/** One file on a card that holds several, and the cut its name reads as; null for the cut most files are. */
export const isDuplicateFile = object({ media: isMediaItem, cut: nullable(isFileCut) })

export type DuplicateFile = Infer<typeof isDuplicateFile>

/** One of a movie's cards: the card as listed, and the files on it, best first. */
export const isDuplicateCard = object({ entry: isPosterEntry, files: listOf(isDuplicateFile) })

export type DuplicateCard = Infer<typeof isDuplicateCard>

/**
 * A movie with more than one file in a library, and the cards they make:
 * one while they share it, more once split apart, the movie's own first.
 */
export const isDuplicate = object({ itemId: isNumber, cards: listOf(isDuplicateCard) })

export type Duplicate = Infer<typeof isDuplicate>

/**
 * `GET /api/libraries/:id/duplicates`: a movie library's movies with more
 * than one file, split apart or not, by title. A split movie stays, so its
 * cards can be put back together.
 */
export const isDuplicates = listOf(isDuplicate)

export type Duplicates = Infer<typeof isDuplicates>

/**
 * How a card's files are split: `apart` gives each its own card; `smart`
 * gives each cut its own, keeping the files of one cut together.
 */
export const isSplitHow = oneOf(['apart', 'smart'])

export type SplitHow = Infer<typeof isSplitHow>

/** `POST /api/libraries/:id/duplicates/split`: the card, named by any file on it, and how. */
export const isSplitRequest = object({ mediaId: isNumber, how: isSplitHow })

export type SplitRequest = Infer<typeof isSplitRequest>

/** `POST /api/libraries/:id/duplicates/join`: the movie whose files share one card again. */
export const isJoinRequest = object({ itemId: isNumber })

export type JoinRequest = Infer<typeof isJoinRequest>

/** `GET /api/home`: every video in progress, then each pinned library's shelf, as the side menu orders them. */
export const isHome = object({
  /** Videos with a saved spot, the most recently watched first. */
  inProgress: isPosterEntries,
  shelves: listOf(isHomeShelf),
})

export type Home = Infer<typeof isHome>

/**
 * `GET /api/home/search?q=`: a row for each library holding a match, as the
 * side menu orders them, and none for a library with nothing that matches.
 */
export const isHomeSearch = listOf(isHomeShelf)

export type HomeSearch = Infer<typeof isHomeSearch>

/** A person's page: who they are, and everything in raven they are credited on. */
export const isPersonDetails = object({
  id: isNumber,
  name: isString,
  photoVersion: nullable(isString),
  /** Movies and shows on disk, newest first. */
  credits: listOf(object({ item: isItemSummary, job: isCreditJob, role: nullable(isString) })),
})

export type PersonDetails = Infer<typeof isPersonDetails>

/** A logo is the title drawn as art, on a clear ground, for a movie's page. */
export const isItemImageKind = oneOf(['poster', 'backdrop', 'still', 'logo'])

/** The pictures an item can have. */
export type ItemImageKind = Infer<typeof isItemImageKind>

export const ITEM_IMAGE_KINDS = isItemImageKind.values

/**
 * A poster's own width: what it is served at when no width is asked for, and
 * the widest it comes in. `posterSrcSet` lists it at the URL with no width,
 * and the server keeps a poster at it by default, so both read it here.
 */
export const POSTER_OWN_WIDTH = 500

/**
 * The widths a poster comes in, narrowest first, so a card fetches one no
 * wider than it shows. A fixed few, never any number, so the server's cache
 * holds at most these.
 */
export const isPosterWidth = oneOf([185, 342, POSTER_OWN_WIDTH])

export type PosterWidth = Infer<typeof isPosterWidth>

export const POSTER_WIDTHS = isPosterWidth.values

/**
 * The poster width a query's `w` asks for, written as `posterSrcSet` writes
 * it, or null for anything else: another number, or the same one spelled
 * another way.
 */
export const posterWidthFrom = (param: unknown): PosterWidth | null =>
  POSTER_WIDTHS.find((width) => String(width) === param) ?? null

/** One picture a movie or show could show: a file beside the media, or one of TMDB's. */
export const isImageOption = object({
  source: oneOf(['local', 'tmdb']),
  /** The file's path for `local`; TMDB's path for `tmdb`, served through `imageOptionUrl`. */
  ref: isString,
  width: nullable(isNumber),
  height: nullable(isNumber),
  /** ISO 639-1, or null for a picture with no text. */
  language: nullable(isString),
  /** Whether the item shows this one now. */
  current: isBoolean,
})

export type ImageOption = Infer<typeof isImageOption>

/** Everything a movie or show could show as its poster and backdrop, and a movie as its logo. */
export const isItemImageOptions = object({
  poster: listOf(isImageOption),
  backdrop: listOf(isImageOption),
  /** TMDB's PNG logos; none for a show, whose page shows no logo. */
  logo: listOf(isImageOption),
})

export type ItemImageOptions = Infer<typeof isItemImageOptions>

/** The pictures Edit images can choose: the ones `ItemImageOptions` offers. */
export type ChoosableImageKind = keyof ItemImageOptions

/** What Edit images picks: one of TMDB's pictures, or the one beside the media. */
export const isImageChoice = union(
  object({ source: oneOf(['tmdb']), ref: isString }),
  object({ source: oneOf(['local']) }),
)

export type ImageChoice = Infer<typeof isImageChoice>

/** The values each playback setting takes. */
export const PLAYBACK_CHOICES = {
  directPlay: ['auto', 'force'],
  transcoding: ['on', 'remuxOnly', 'off'],
  maxHeight: [2160, 1080, 720],
  quality: ['low', 'medium', 'high'],
  hwAccel: ['auto', 'videotoolbox', 'vaapi', 'none'],
} as const

export const isHwAccel = oneOf(PLAYBACK_CHOICES.hwAccel)

/** What encodes a transcode: `auto` takes the GPU the machine has, `none` keeps to the CPU. */
export type HwAccel = Infer<typeof isHwAccel>

/** How the server plays video, set once for every viewer in Settings. */
export const isPlaybackSettings = object({
  /**
   * `auto` plays the original file when the browser takes it and converts
   * otherwise; `force` always sends the original file, for a browser the
   * check underrates.
   */
  directPlay: oneOf(PLAYBACK_CHOICES.directPlay),
  /**
   * `on` remuxes and transcodes as needed; `remuxOnly` never re-encodes
   * video; `off` converts nothing, so only files the browser plays as they
   * are play.
   */
  transcoding: oneOf(PLAYBACK_CHOICES.transcoding),
  /** The frame a transcode is scaled down to. */
  maxHeight: oneOf(PLAYBACK_CHOICES.maxHeight),
  /** How hard a transcode is squeezed: `low` for a slow network, `high` for a big screen. */
  quality: oneOf(PLAYBACK_CHOICES.quality),
  /** What encodes a transcode: `auto` takes the GPU the machine has, `none` keeps to the CPU. */
  hwAccel: isHwAccel,
  /** Whether HDR is tone mapped to SDR on a transcode when the build can. */
  tonemap: isBoolean,
})

export type PlaybackSettings = Infer<typeof isPlaybackSettings>

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  directPlay: 'auto',
  transcoding: 'on',
  maxHeight: 1080,
  quality: 'medium',
  hwAccel: 'auto',
  tonemap: true,
}

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isPlaybackSettingsChange = exactPartial(isPlaybackSettings.shape)

export const isEncoderKind = oneOf(['software', 'vaapi', 'videotoolbox'])

/** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
export type EncoderKind = Infer<typeof isEncoderKind>

/** The settings as kept, with what they come to on this machine. */
export const isPlaybackSettingsState = object({
  settings: isPlaybackSettings,
  effective: object({
    /** What transcodes encode with, after the test encode. */
    encoder: isEncoderKind,
    /** Whether this ffmpeg can tone map at all. */
    tonemapAvailable: isBoolean,
  }),
})

export type PlaybackSettingsState = Infer<typeof isPlaybackSettingsState>

/** The values each display setting takes. */
export const DISPLAY_CHOICES = {
  titles: ['logo', 'text'],
} as const

/** How pages look, set once for every viewer in Settings. */
export const isDisplaySettings = object({
  /** `logo` shows a movie's title as its logo where TMDB has one; `text` always spells it out. */
  titles: oneOf(DISPLAY_CHOICES.titles),
})

export type DisplaySettings = Infer<typeof isDisplaySettings>

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { titles: 'logo' }

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isDisplaySettingsChange = exactPartial(isDisplaySettings.shape)

export type DisplaySettingsChange = Infer<typeof isDisplaySettingsChange>

/** The fields Edit metadata can write over: what a page shows for a movie or show. */
export const isItemMetadata = object({
  title: isString,
  year: nullable(isNumber),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
})

export type ItemMetadata = Infer<typeof isItemMetadata>

/** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
export const isItemMetadataState = object({
  shown: isItemMetadata,
  original: isItemMetadata,
  overridden: listOf(keyOf(isItemMetadata.shape)),
})

export type ItemMetadataState = Infer<typeof isItemMetadataState>

/** Only known fields, each text, a number for the year, or null; nothing else. */
export const isItemMetadataChange = exactPartial({
  title: nullable(isString),
  year: nullable(isNumber),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
} satisfies { [K in keyof ItemMetadata]: Guard<ItemMetadata[K] | null> })

/**
 * What Edit metadata sends: each field given is written over, or cleared
 * back to TMDB's with null. An empty field over TMDB's words is '', or 0 for
 * the year, and shows as nothing; a title cannot be empty.
 */
export type ItemMetadataChange = Infer<typeof isItemMetadataChange>

/** TMDB's ids are digits, which raven keeps as text. */
export const isTmdbId = (value: unknown): value is string => isString(value) && /^\d+$/.test(value)

/** One of TMDB's search results, offered by Fix match. */
export const isMatchCandidate = object({
  tmdbId: isString,
  title: isString,
  year: nullable(isNumber),
  overview: nullable(isString),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** How sure Fix match is that this is the folder's or file's movie or show: a whole number from 0 to 100. */
  confidence: isNumber,
})

export type MatchCandidate = Infer<typeof isMatchCandidate>

export const isMatchCandidateList = listOf(isMatchCandidate)

/** What a Fix match search is for: a file (and the show folder it is in), or a matched show. */
export const isMatchSubject = union(
  object({ kind: oneOf(['media']), id: isNumber }),
  object({ kind: oneOf(['item']), id: isNumber }),
)

export type MatchSubject = Infer<typeof isMatchSubject>

/** A place inside a library, as the server keeps a group's Fix match: a relative path, never an absolute one. */
export const isLibraryPlace = (value: unknown): value is string =>
  isString(value) && value !== '' && !value.startsWith('/')

/**
 * A movie or show the AI lookup offers for files it was not sure of.
 * Accepting it is a Fix match to `tmdbId`.
 */
export const isAiSuggestion = object({
  tmdbId: isTmdbId,
  title: isString,
  year: nullable(isNumber),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** Why Claude thinks so, in a sentence or two. */
  reason: isString,
  /**
   * The group the lookup was asked about: a show's folder, a movie's folder
   * when it holds that one movie, else the movie file's own place.
   */
  place: isLibraryPlace,
})

export type AiSuggestion = Infer<typeof isAiSuggestion>

/** A file no movie or show was found for, as Not matched lists it. */
export const isUnmatchedFile = object({
  ...isMediaItem.shape,
  /** What the AI lookup suggests for its folder; null when it was not asked, chose nothing, or is sure. */
  aiSuggestion: nullable(isAiSuggestion),
})

export type UnmatchedFile = Infer<typeof isUnmatchedFile>

export const isUnmatchedList = listOf(isUnmatchedFile)

export const isMetadataServiceState = oneOf(['off', 'ok', 'failing'])

/** `off` when not configured, `failing` when the last call went wrong. */
export type MetadataServiceState = Infer<typeof isMetadataServiceState>

/** How metadata is doing, from `/api/health`. */
export const isMetadataHealth = object({
  tmdb: isMetadataServiceState,
  omdb: isMetadataServiceState,
  /** Files waiting to be matched. */
  pending: isNumber,
  /** Why TMDB is failing, never the token itself. */
  error: nullable(isString),
  /** When TMDB last answered. */
  lastOk: nullable(isString),
  /** The AI lookup: `off` without ANTHROPIC_API_KEY, `failing` when its last call went wrong. */
  ai: isMetadataServiceState,
  /** AI lookups left today; 0 while it is off. */
  aiRemaining: isNumber,
  /** Groups waiting for or in an AI lookup, across libraries; 0 between passes. */
  aiPending: isNumber,
})

export type MetadataHealth = Infer<typeof isMetadataHealth>

/** What `/api/health` answers: the server is up, and how its parts are doing. */
export const isServerHealth = object({
  status: oneOf(['ok']),
  /** null when ffmpeg is missing, in which case nothing but direct play works. */
  ffmpeg: nullable(isString),
  /** Whether HDR thumbnails and transcodes get tone mapped to SDR. */
  tonemap: isBoolean,
  /** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
  encoder: isEncoderKind,
  thumbnailsPending: isNumber,
  /** Whether TMDB is configured and answering, and how many files wait to be matched. */
  metadata: isMetadataHealth,
})

export type ServerHealth = Infer<typeof isServerHealth>

/** A video in a library's history: when it last played or was marked, how often it really played, and how far it got. */
export const isHistoryEntry = object({
  media: isMediaItem,
  lastPlayedAt: isString,
  plays: isNumber,
  /** The furthest any play got, in seconds. */
  furthest: isNumber,
  /** Whether a play got to the library's watched percentage, or a mark holds it watched. */
  watched: isBoolean,
  /** Whether Mark as watched holds it watched; `plays` and `furthest` count real plays only. */
  marked: isBoolean,
})

export type HistoryEntry = Infer<typeof isHistoryEntry>

export const isHistory = listOf(isHistoryEntry)

/**
 * Whether locked libraries can be opened here: `available` once the server
 * has a PIN, `unlocked` once this browser has entered it.
 */
export const isLockState = object({
  available: isBoolean,
  unlocked: isBoolean,
})

export type LockState = Infer<typeof isLockState>

/**
 * The admin lock, as it stands for this browser. It is on until the admin
 * password is entered here, and while it is, locked libraries are left out
 * altogether, no video can be deleted, and no file's path is handed out.
 * `available` once the server has a strong `ADMIN_PASSWORD`, so it can be
 * turned off. Turned back on, it waits `remainingMs` (counted from this
 * answer) before it holds, and until then it goes off again with no password.
 */
export const isAdminLock = union(
  object({ state: oneOf(['on']), available: isBoolean }),
  object({ state: oneOf(['turningOn']), remainingMs: isNumber }),
  object({ state: oneOf(['off']) }),
)

export type AdminLock = Infer<typeof isAdminLock>

/** Where a video's file lives, as the server sees it (a container path under Docker). */
export const isMediaLocation = object({
  path: isString,
})

export type MediaLocation = Infer<typeof isMediaLocation>

/**
 * What the server tells a client as it happens: a library's videos changed,
 * so whatever shows them should be read again.
 */
export const isServerEvent = object({
  type: oneOf(['library']),
  libraryId: isNumber,
})

export type ServerEvent = Infer<typeof isServerEvent>

export const isDirectoryEntry = object({
  name: isString,
  path: isString,
})

export type DirectoryEntry = Infer<typeof isDirectoryEntry>

export const isDirectoryListing = object({
  path: isString,
  /** null at the browse root, where the server will not go any higher. */
  parent: nullable(isString),
  directories: listOf(isDirectoryEntry),
})

export type DirectoryListing = Infer<typeof isDirectoryListing>

export const isAudioTrack = object({
  /** Position among the file's audio tracks, as ffmpeg's `0:a:N` counts them. */
  index: isNumber,
  /** ffprobe codec name: 'aac', 'eac3', 'truehd', ... */
  codec: nullable(isString),
  channels: nullable(isNumber),
  /** Normalised by `languageTag`: 'en' for 'eng', 'English' or 'en-US'; null when untagged. */
  language: nullable(isString),
  title: nullable(isString),
  default: isBoolean,
})

export type AudioTrack = Infer<typeof isAudioTrack>

export const isSubtitleSource = oneOf(['embedded', 'external'])

/** Embedded in the video file, or a file of its own beside it. */
export type SubtitleSource = Infer<typeof isSubtitleSource>

export const isSubtitleTrack = object({
  /** Stable for the file: `embedded-N` for the Nth subtitle stream, `external-N` for the Nth sidecar. */
  id: isString,
  source: isSubtitleSource,
  /** ffprobe codec name ('subrip', 'ass', 'hdmv_pgs_subtitle', ...), or the sidecar's extension. */
  codec: nullable(isString),
  /** Normalised by `languageTag`, like an audio track's. */
  language: nullable(isString),
  title: nullable(isString),
  default: isBoolean,
  forced: isBoolean,
  hearingImpaired: isBoolean,
  /** Text tracks convert to WebVTT; image tracks (PGS, VobSub, DVB) cannot be shown. */
  supported: isBoolean,
})

export type SubtitleTrack = Infer<typeof isSubtitleTrack>

/** What a player can choose between, read from the file when it is opened. */
export const isMediaTracks = object({
  audio: listOf(isAudioTrack),
  subtitles: listOf(isSubtitleTrack),
  /** The audio track direct play gets: the one flagged default, else the first. */
  defaultAudio: nullable(isNumber),
  /** Frames per second, for stepping a frame at a time. */
  frameRate: nullable(isNumber),
})

export type MediaTracks = Infer<typeof isMediaTracks>

/**
 * One subtitle, timed against the file. `text` may hold `<i>`, `<b>` and `<u>`.
 * Read from WebVTT by `parseWebVtt`, never from JSON, so it has no guard.
 */
export type SubtitleCue = {
  start: number
  end: number
  text: string
}

export const isPlaybackMode = oneOf(['direct', 'remux', 'transcode'])

/**
 * How a file reaches the player: the original bytes, a remux with the video
 * copied and the audio converted, or a full conversion of both.
 */
export type PlaybackMode = Infer<typeof isPlaybackMode>

export const isStreamMode = oneOf(['remux', 'transcode']) satisfies Guard<PlaybackMode>

/** The two ways the server can convert a file on the fly. */
export type StreamMode = Infer<typeof isStreamMode>

export const STREAM_MODES = isStreamMode.values

/*
 * Request bodies: what a client sends, checked by the server with the same
 * guard the client's call is typed by.
 */

/** A spot in a file, in seconds from its start. */
const isSeconds = (value: unknown): value is number => isNumber(value) && value >= 0

/** `PUT /api/media/:id/progress`: where playback got to. */
export const isProgressChange = object({
  position: isSeconds,
})

export type ProgressChange = Infer<typeof isProgressChange>

/** `PUT /api/media/:id/favourite`. */
export const isFavouriteChange = object({
  favourite: isBoolean,
})

export type FavouriteChange = Infer<typeof isFavouriteChange>

/**
 * What `PUT /api/watched` marks: the card a file is on, or every card under
 * an item (a show, season, episode or movie) in one library, or in every
 * library the viewer may see when `libraryId` is null.
 */
export const isWatchTarget = union(
  object({ kind: oneOf(['media']), id: isNumber }),
  object({ kind: oneOf(['item']), id: isNumber, libraryId: nullable(isNumber) }),
)

export type WatchTarget = Infer<typeof isWatchTarget>

const isWatchTargets = (value: unknown): value is WatchTarget[] =>
  listOf(isWatchTarget)(value) && value.length > 0 && value.length <= MAX_WATCH_TARGETS

/** `PUT /api/watched`: mark every target, from one to `MAX_WATCH_TARGETS`, watched or unwatched. */
export const isWatchedChange = object({
  watched: isBoolean,
  targets: isWatchTargets,
})

export type WatchedChange = Infer<typeof isWatchedChange>

/** `POST /api/lock/unlock`: the PIN that opens every locked library. */
export const isUnlockRequest = object({
  pin: isString,
})

export type UnlockRequest = Infer<typeof isUnlockRequest>

/** `POST /api/admin/unlock`: the admin password, which turns the admin lock off in this browser. */
export const isAdminUnlockRequest = object({
  password: isString,
})

export type AdminUnlockRequest = Infer<typeof isAdminUnlockRequest>

/** `PUT /api/media/:id/match`: a TMDB id for Fix match, or null for a file that is not one at all. */
export const isMatchChoice = object({
  tmdbId: nullable(isTmdbId),
})

export type MatchChoice = Infer<typeof isMatchChoice>

/** `PUT /api/items/:id/match`: the TMDB show to point a show's files at. */
export const isShowMatchChoice = object({
  tmdbId: isTmdbId,
})

export type ShowMatchChoice = Infer<typeof isShowMatchChoice>
