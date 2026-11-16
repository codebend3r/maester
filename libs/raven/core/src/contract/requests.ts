import { isMatchItemType } from '@/contract/items'
import { isTmdbId } from '@/contract/metadata'
import { isUpcomingKind } from '@/contract/upcoming'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  optional,
} from '@/schema'

/** Where members ask for a Coming soon title to be downloaded and read how far each got, and where the owner reads who asked for each. */
export const REQUEST_PATHS = {
  requests: '/api/requests',
  everyone: '/api/requests/everyone',
} as const

/** The parameters of an upcoming title's own page on the server. */
export const UPCOMING_TITLE_PARAMS = { type: 'type', tmdbId: 'tmdbId' } as const

/** Where the server answers whether a title's Sonarr or Radarr holds it already, and where it stands there. */
export const REQUEST_HOLDING_PATH =
  `${REQUEST_PATHS.requests}/:${UPCOMING_TITLE_PARAMS.type}/:${UPCOMING_TITLE_PARAMS.tmdbId}` as const

/** Where the server answers with one upcoming title's details from TMDB. */
export const UPCOMING_TITLE_PATH =
  `/api/upcoming/:${UPCOMING_TITLE_PARAMS.type}/:${UPCOMING_TITLE_PARAMS.tmdbId}` as const

/** Where a request stands, as its Sonarr or Radarr last told the server. */
export const REQUEST_STATUSES = {
  searching: 'searching',
  notDownloadable: 'notDownloadable',
  willDownload: 'willDownload',
  downloading: 'downloading',
  downloaded: 'downloaded',
} as const

export type RequestStatus = (typeof REQUEST_STATUSES)[keyof typeof REQUEST_STATUSES]

export const isRequestStatus = oneOf(Object.values(REQUEST_STATUSES))

/** `POST` on `REQUEST_PATHS.requests`: the movie or show to download, by its TMDB id. */
export const isTitleRequestAsk = object({
  type: isMatchItemType,
  tmdbId: isTmdbId,
})

export type TitleRequestAsk = Infer<typeof isTitleRequestAsk>

/**
 * One title someone asked for, or one its Sonarr or Radarr holds that is
 * still to come. One request covers everyone, so it says only whether it was
 * the caller's.
 */
export const isTitleRequest = object({
  type: isMatchItemType,
  tmdbId: isString,
  title: isString,
  status: isRequestStatus,
  /** When it was asked for, as an ISO time. */
  requestedAt: isString,
  isMine: isBoolean,
  /**
   * True for a title still to come that its arr holds though nobody asked
   * raven for it: it downloads as a request does, so every account sees it
   * among their own, and `requestedAt` is when the arr took it on. An older
   * server leaves it out.
   */
  isHeld: optional(isBoolean),
  /**
   * The library's item for the title once a scan has added it, or null while
   * no library holds it. An older server leaves it out, which reads as not
   * added, so its whole list stays readable as pending.
   */
  libraryItemId: optional(nullable(isNumber)),
})

export type TitleRequest = Infer<typeof isTitleRequest>

/**
 * A request as the owner reads it: also whose it was, an account's id or the
 * one account a server without accounts keeps, or null for a held title,
 * which its Sonarr or Radarr took on with nobody asking.
 */
export const isMemberRequest = object({
  ...isTitleRequest.shape,
  requestedBy: nullable(isString),
})

export type MemberRequest = Infer<typeof isMemberRequest>

/** `GET` on `REQUEST_PATHS.everyone`: every request and held title still to come, newest first, for the owner alone. */
export const isMemberRequests = listOf(isMemberRequest)

/** How many requests the caller has left in the last 24 hours, and when the next comes back while none do. */
export const isRequestBudget = object({
  limit: isNumber,
  left: isNumber,
  /** When the oldest request in the window drops out, as an ISO time; null while some are left. */
  nextAt: nullable(isString),
  /** True for whoever manages raven, whose requests no budget holds; an older server leaves it out. */
  isUnlimited: optional(isBoolean),
})

export type RequestBudget = Infer<typeof isRequestBudget>

/** Whether each kind of title can be requested: off while its Sonarr or Radarr is not set up. */
export const isRequestKinds = object({
  movie: isBoolean,
  show: isBoolean,
})

/** `GET` on `REQUEST_PATHS.requests`: every request and held title still to come, newest first, the caller's budget, and which kinds are on. */
export const isTitleRequests = object({
  requests: listOf(isTitleRequest),
  budget: isRequestBudget,
  kinds: isRequestKinds,
})

export type TitleRequests = Infer<typeof isTitleRequests>

/**
 * `GET` on `REQUEST_HOLDING_PATH`: whether the title's Sonarr or Radarr
 * holds it already, so it downloads once it can and nobody needs to request
 * it. `status` is where it stands there, or null while the arr does not hold
 * it (or its kind is off).
 */
export const isTitleHolding = object({
  status: nullable(isRequestStatus),
})

export type TitleHolding = Infer<typeof isTitleHolding>

/** An upcoming movie or show as its own page shows it, from TMDB. */
export const isUpcomingDetails = object({
  type: isMatchItemType,
  tmdbId: isString,
  title: isString,
  /** `YYYY-MM-DD`, or null while TMDB has no date. */
  released: nullable(isString),
  /** TMDB's poster path, served through `/api/images/poster`. */
  poster: nullable(isString),
  /** TMDB's backdrop path, served through `/api/images/backdrop`. */
  backdrop: nullable(isString),
  summary: nullable(isString),
  tagline: nullable(isString),
  genres: listOf(isString),
  /** Minutes: a movie's length, or an episode's. */
  runtime: nullable(isNumber),
  /** Whether it is a movie, a show, a documentary or anime; an older server leaves it out. */
  kind: optional(isUpcomingKind),
})

export type UpcomingDetails = Infer<typeof isUpcomingDetails>

/** The key a request and its title share: one request for each movie or show. */
export const requestKeyOf = ({ type, tmdbId }: TitleRequestAsk): string => `${type}:${tmdbId}`
