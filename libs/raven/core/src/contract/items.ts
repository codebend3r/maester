import { isRatingSource } from '@/contract/libraries'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  listOf,
  nullable,
  object,
  oneOf,
  optional,
  union,
} from '@/schema'

export const THUMBNAIL_STATES = { pending: 'pending', ready: 'ready', failed: 'failed' } as const

export const isThumbnailState = oneOf(Object.values(THUMBNAIL_STATES))

export type ThumbnailState = Infer<typeof isThumbnailState>

/**
 * `pending` waits for matching, `matched` found its item by itself,
 * `manual` was chosen with Fix match, `unmatched` found nothing sure, and
 * `off` is a library that is not matched, or an extra.
 */
export const MATCH_STATES = {
  pending: 'pending',
  matched: 'matched',
  manual: 'manual',
  unmatched: 'unmatched',
  off: 'off',
} as const

export const isMatchState = oneOf(Object.values(MATCH_STATES))

export type MatchState = Infer<typeof isMatchState>

export const ITEM_TYPES = {
  movie: 'movie',
  show: 'show',
  season: 'season',
  episode: 'episode',
} as const

export const isItemType = oneOf(Object.values(ITEM_TYPES))

export type ItemType = Infer<typeof isItemType>

/** What Fix match and matching look files up as on TMDB, and what Edit images chooses pictures for. */
export const isMatchItemType = oneOf([ITEM_TYPES.movie, ITEM_TYPES.show])

export type MatchItemType = Infer<typeof isMatchItemType>

/** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
export const RATING_KINDS = { critic: 'critic', audience: 'audience' } as const

export const isRating = object({
  source: isRatingSource,
  kind: oneOf(Object.values(RATING_KINDS)),
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
  /**
   * The day it came out or first aired, as `YYYY-MM-DD`, from TMDB; null when
   * it gave none, and absent from a server older than this field, which a web
   * app served apart from it (Netlify, a dev server on Vhagar) can still meet.
   */
  released: optional(nullable(isString)),
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

export const CREDIT_JOBS = {
  cast: 'cast',
  guest: 'guest',
  director: 'director',
  writer: 'writer',
  creator: 'creator',
  producer: 'producer',
} as const

export const isCreditJob = oneOf(Object.values(CREDIT_JOBS))

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
  type: oneOf([ITEM_TYPES.season]),
  /** Its episodes with a file this browser may see. */
  episodeCount: isNumber,
  /** Of `episodeCount`, those watched. */
  watchedCount: isNumber,
})

export type SeasonSummary = Infer<typeof isSeasonSummary>

/** An episode on its season's page: what its row shows, and the file Play starts. */
export const isEpisodeSummary = object({
  ...isItemSummary.shape,
  type: oneOf([ITEM_TYPES.episode]),
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

/** What an item's page shows of its pictures in one library. */
export const isLibraryPictures = object({
  libraryId: isNumber,
  posterVersion: nullable(isString),
  backdropVersion: nullable(isString),
  logoVersion: nullable(isString),
})

export type LibraryPictures = Infer<typeof isLibraryPictures>

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
  /** The title as TMDB's art, on a clear ground; null when it has none, and for a season or episode. */
  logoVersion: nullable(isString),
  /**
   * Whether a show or season is a favourite; null where it cannot be one: a
   * movie or episode, whose files are favourites instead, or one only locked
   * libraries hold.
   */
  favourite: nullable(isBoolean),
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
  /**
   * Its pictures as each library the caller sees that holds it shows them,
   * as Edit images can choose them for one library alone; the page shows the
   * library's it was reached from. Absent from a server older than this
   * field, which a web app served apart from it can still meet.
   */
  libraryPictures: optional(listOf(isLibraryPictures)),
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
