import { Inject, Injectable } from '@nestjs/common'
import {
  foldTitle,
  isTvMovieId,
  ITEM_TYPES,
  type MatchItemType,
  METADATA_SERVICE_STATES,
  type MetadataServiceState,
  TMDB_GENRES,
  TMDB_MATCH_PREFIXES,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { ERROR_NAMES } from '@/errorMessage'
import { RAVEN_HEADERS } from '@/http'
import {
  type FetchedItem,
  type FetchedPerson,
  type MatchFacts,
  type MovieExtras,
  type SearchResult,
  TMDB_SEGMENTS,
  type TmdbImages,
  tmdbRating,
  toAlternativeTitles,
  toFoundIds,
  toLogo,
  toMatchFacts,
  toMovie,
  toMovieExtras,
  toPerson,
  toSearchResults,
  toSeason,
  toShow,
  toTmdbImages,
} from '@/metadata/tmdbShapes'
import { type RateLimit, createRateLimit } from '@/scanner/concurrency'

type MetadataFetchProps = {
  url: string
  init: { headers: Record<string, string>; signal: AbortSignal }
}

/**
 * The slice of `fetch` metadata uses, injected so tests answer for TMDB and
 * OMDb and never touch the network.
 */
export type MetadataFetch = (request: MetadataFetchProps) => Promise<Response>

/** The DI token the fetch is provided under. */
export const METADATA_FETCH = Symbol('METADATA_FETCH')

const API = 'https://api.themoviedb.org/3'

type SourceOfProps = { type: MatchItemType; tmdbId: string }

/** A library's movie can be catalogued by TMDB as a TV documentary. Keep the namespaces distinct. */
const sourceOf = ({ type, tmdbId }: SourceOfProps) =>
  type === ITEM_TYPES.movie && isTvMovieId(tmdbId)
    ? { type: ITEM_TYPES.show, tmdbId: tmdbId.slice(TMDB_MATCH_PREFIXES.tvMovie.length) }
    : { type, tmdbId }

type ItemPathProps = { type: MatchItemType; tmdbId: string }

/** `/movie/{id}` or `/tv/{id}`, which TMDB's details, images and alternative titles hang off. */
const itemPath = ({ type, tmdbId }: ItemPathProps): string =>
  `/${TMDB_SEGMENTS[type]}/${encodeURIComponent(tmdbId)}`

/** TMDB's search routes, which the client calls and the test fake answers. */
export const TMDB_SEARCH_ROUTES = { movie: '/search/movie', show: '/search/tv' } as const

/** One call may take this long before it counts as TMDB being down. */
const TIMEOUT_MS = 10_000

/** How often a 429 is waited out before the call gives up. */
const RETRIES = 3

/**
 * A title with its accents as single characters. A Mac's SMB mount names a
 * folder with each accent as a combining mark, and TMDB finds nothing for
 * "Shōgun" in that form while it finds the show in this one.
 */
const composed = (title: string): string => title.normalize('NFC')

/** TMDB's older API key: 32 hex characters, sent as `api_key` rather than as a bearer token. */
const API_KEY = /^[a-f0-9]{32}$/i

/** The other databases' ids TMDB can find a movie or show by. */
export const TMDB_EXTERNAL_SOURCES = { imdbId: 'imdb_id', tvdbId: 'tvdb_id' } as const

type TmdbExternalSource = (typeof TMDB_EXTERNAL_SOURCES)[keyof typeof TMDB_EXTERNAL_SOURCES]

export const TMDB_ERROR_KINDS = {
  unauthorized: 'unauthorized',
  notFound: 'not-found',
  unavailable: 'unavailable',
} as const

export type TmdbErrorKind = (typeof TMDB_ERROR_KINDS)[keyof typeof TMDB_ERROR_KINDS]

type TmdbErrorProps = { kind: TmdbErrorKind; message: string }

/** 401 is a wrong token, 404 an id TMDB no longer has, and anything else TMDB being away. */
export class TmdbError extends Error {
  readonly kind: TmdbErrorKind

  constructor({ kind, message }: TmdbErrorProps) {
    super(message)
    this.name = 'TmdbError'
    this.kind = kind
  }
}

/** What a body the mappers cannot read is reported as: TMDB answered, but not with what was asked. */
const unreadable = (what: string): TmdbError =>
  new TmdbError({ kind: TMDB_ERROR_KINDS.unavailable, message: `TMDB sent an unreadable ${what}.` })

export type TmdbState = {
  state: MetadataServiceState
  error: string | null
  lastOk: string | null
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Seconds from a `Retry-After` header, capped so a strange answer cannot stall a pass for long. */
const retryAfterMs = (header: string | null): number => {
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : 1000
}

type TmdbClientGetProps = {
  path: string
  params?: Record<string, string>
}

type TmdbClientSearchMoviesProps = {
  query: string
  year: number | null
  /** Takes in titles TMDB keeps out of an ordinary search. */
  includeAdult?: boolean
}

type TmdbClientSearchShowsProps = {
  query: string
  year: number | null
}

type TmdbClientSeasonProps = {
  showTmdbId: string
  number: number
}

type TmdbClientFindProps = {
  id: string
  source: TmdbExternalSource
}

type TmdbClientAlternativeTitlesProps = {
  type: MatchItemType
  tmdbId: string
}

type TmdbClientMatchFactsProps = { type: MatchItemType; tmdbId: string }

type TmdbClientScoreProps = {
  type: MatchItemType
  tmdbId: string
}

type TmdbClientImagesProps = { type: MatchItemType; tmdbId: string }

/**
 * TMDB's API v3, read with a bearer token. Keeps to 20 calls a second with
 * at most 4 in flight, waits out a 429 and halves its rate after one, and
 * gives every call 10 seconds. A 401 means the token is wrong, so it stops
 * calling at all until a restart rather than retrying in a loop.
 */
@Injectable()
export class TmdbClient {
  private readonly limit: RateLimit = createRateLimit({ perSecond: 20, inFlight: 4 })
  private readonly status: { error: string | null; lastOk: string | null; refused: boolean } = {
    error: null,
    lastOk: null,
    refused: false,
  }

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
  ) {}

  /** Whether there is a token, and TMDB has not refused it. */
  get enabled(): boolean {
    return this.config.tmdbApiToken != null && !this.status.refused
  }

  state(): TmdbState {
    if (this.config.tmdbApiToken == null) {
      return { state: METADATA_SERVICE_STATES.off, error: null, lastOk: null }
    }
    return {
      state:
        this.status.error == null ? METADATA_SERVICE_STATES.ok : METADATA_SERVICE_STATES.failing,
      error: this.status.error,
      lastOk: this.status.lastOk,
    }
  }

  /** Back to the full rate, at the start of a pass. */
  newPass(): void {
    this.limit.reset()
  }

  /** ISO 639-1, which TMDB tags pictures with: `en` of `en-US`. */
  private get language(): string {
    return this.config.metadataLanguage.slice(0, 2)
  }

  /** The `include_image_language` every call that appends or asks for images sends. */
  private get imageLanguages(): string {
    return `${this.language},null`
  }

  private async get({ path, params = {} }: TmdbClientGetProps): Promise<unknown> {
    const token = this.config.tmdbApiToken
    if (token == null || this.status.refused) {
      throw new TmdbError({
        kind: TMDB_ERROR_KINDS.unauthorized,
        message: 'TMDB is not configured.',
      })
    }
    // TMDB's settings page shows two credentials; either works here.
    const asKey = API_KEY.test(token)
    const query = new URLSearchParams({
      language: this.config.metadataLanguage,
      ...params,
      ...(asKey ? { api_key: token } : {}),
    })
    const url = `${API}${path}?${query.toString()}`
    const headers: Record<string, string> = asKey
      ? { [HEADERS.accept]: CONTENT_TYPES.json }
      : {
          [HEADERS.accept]: CONTENT_TYPES.json,
          [RAVEN_HEADERS.authorization]: `Bearer ${token}`,
        }

    const attempt = async (retriesLeft: number): Promise<unknown> => {
      const response = await this.limit
        .run(() => this.fetch({ url, init: { headers, signal: AbortSignal.timeout(TIMEOUT_MS) } }))
        .catch((error: unknown) => {
          const reason =
            error instanceof Error && error.name === ERROR_NAMES.timeoutError
              ? 'TMDB did not answer within 10 seconds.'
              : 'TMDB could not be reached.'
          this.status.error = reason
          throw new TmdbError({ kind: TMDB_ERROR_KINDS.unavailable, message: reason })
        })
      if (response.status === 429 && retriesLeft > 0) {
        this.limit.slowDown()
        await sleep(retryAfterMs(response.headers.get(RAVEN_HEADERS.retryAfter)))
        return attempt(retriesLeft - 1)
      }
      if (response.status === 401) {
        this.status.refused = true
        this.status.error = 'TMDB refused the token (401). Check TMDB_API_TOKEN and restart.'
        throw new TmdbError({ kind: TMDB_ERROR_KINDS.unauthorized, message: this.status.error })
      }
      if (response.status === 404) {
        this.markOk()
        throw new TmdbError({
          kind: TMDB_ERROR_KINDS.notFound,
          message: `TMDB has nothing at ${path}.`,
        })
      }
      if (!response.ok) {
        this.status.error = `TMDB answered ${response.status}.`
        throw new TmdbError({ kind: TMDB_ERROR_KINDS.unavailable, message: this.status.error })
      }
      const body: unknown = await response.json().catch(() => null)
      this.markOk()
      return body
    }

    return attempt(RETRIES)
  }

  private markOk(): void {
    this.status.error = null
    this.status.lastOk = new Date().toISOString()
  }

  async searchMovies({
    query,
    year,
    includeAdult = false,
  }: TmdbClientSearchMoviesProps): Promise<SearchResult[]> {
    const movies = toSearchResults(
      await this.get({
        path: TMDB_SEARCH_ROUTES.movie,
        params: {
          query: composed(query),
          include_adult: String(includeAdult),
          ...(year == null ? {} : { year: String(year) }),
        },
      }),
    )
    const wanted = foldTitle(query)
    const hasTitle = movies.some((movie) =>
      [movie.title, movie.originalTitle].some(
        (title) => title != null && ` ${foldTitle(title)} `.includes(` ${wanted} `),
      ),
    )
    if (hasTitle || includeAdult) return movies
    // Some feature-length releases are filed only under TV. A movie search
    // can return unrelated films instead, especially with no year filter.
    const shows = await this.searchShows({ query, year })
    return [
      ...movies,
      ...shows
        .filter((show) => show.genreIds.includes(TMDB_GENRES.documentary))
        .map((show) => ({ ...show, tmdbId: `${TMDB_MATCH_PREFIXES.tvMovie}${show.tmdbId}` })),
    ]
  }

  async searchShows({ query, year }: TmdbClientSearchShowsProps): Promise<SearchResult[]> {
    return toSearchResults(
      await this.get({
        path: TMDB_SEARCH_ROUTES.show,
        params: {
          query: composed(query),
          include_adult: 'false',
          ...(year == null ? {} : { first_air_date_year: String(year) }),
        },
      }),
    )
  }

  async show(tmdbId: string): Promise<FetchedItem> {
    const body = await this.get({
      path: itemPath({ type: ITEM_TYPES.show, tmdbId }),
      params: {
        append_to_response: 'aggregate_credits,content_ratings,external_ids,reviews,images',
        include_image_language: this.imageLanguages,
      },
    })
    const show = toShow({ body, country: this.config.metadataCountry, language: this.language })
    if (!show) throw unreadable(`show ${tmdbId}`)
    return show
  }

  /** A season and every episode in it, as TMDB lists them. */
  async season({
    showTmdbId,
    number: seasonNumber,
  }: TmdbClientSeasonProps): Promise<{ season: FetchedItem; episodes: FetchedItem[] }> {
    const body = await this.get({
      path: `${itemPath({ type: ITEM_TYPES.show, tmdbId: showTmdbId })}/season/${seasonNumber}`,
      params: {
        append_to_response: 'credits',
      },
    })
    const season = toSeason(body)
    if (!season) throw unreadable(`season ${seasonNumber} of show ${showTmdbId}`)
    return season
  }

  /** TMDB's ids for an IMDb or TVDB id, by kind. */
  async find({ id, source }: TmdbClientFindProps): Promise<{ movies: string[]; shows: string[] }> {
    return toFoundIds(
      await this.get({
        path: `/find/${encodeURIComponent(id)}`,
        params: { external_source: source },
      }),
    )
  }

  /** The other titles TMDB knows a movie or show by: a country's own, a working title, a translation. */
  async alternativeTitles({ type, tmdbId }: TmdbClientAlternativeTitlesProps): Promise<string[]> {
    return toAlternativeTitles(
      await this.get({ path: `${itemPath(sourceOf({ type, tmdbId }))}/alternative_titles` }),
    )
  }

  /**
   * What Fix match's confidence reads of a result beyond its search: a
   * show's seasons and episode total, or a movie's runtime, and its other
   * titles, in one call.
   */
  async matchFacts({ type, tmdbId }: TmdbClientMatchFactsProps): Promise<MatchFacts> {
    const source = sourceOf({ type, tmdbId })
    const body = await this.get({
      path: itemPath(source),
      params: {
        append_to_response: 'alternative_titles',
      },
    })
    return toMatchFacts({ body, type, asked: source.type })
  }

  /** A movie's or show's TMDB score alone, in one call with nothing appended; null when it has none. */
  async score({ type, tmdbId }: TmdbClientScoreProps): Promise<FetchedItem['rating']> {
    return tmdbRating(await this.get({ path: itemPath({ type, tmdbId }) }))
  }

  /**
   * Every poster, backdrop and PNG logo TMDB holds for a movie or show, in
   * the language details come in and without text, most voted first.
   */
  async images({ type, tmdbId }: TmdbClientImagesProps): Promise<TmdbImages> {
    return toTmdbImages(
      await this.get({
        path: `${itemPath(sourceOf({ type, tmdbId }))}/images`,
        params: {
          include_image_language: this.imageLanguages,
        },
      }),
    )
  }

  /**
   * Only a movie's saga and logo, for a movie stored before raven kept them:
   * the movie with its pictures, in one call, and no credits, dates or
   * reviews.
   */
  async movieExtras(tmdbId: string): Promise<MovieExtras> {
    if (isTvMovieId(tmdbId)) {
      return {
        saga: null,
        logo: await this.showLogo(tmdbId.slice(TMDB_MATCH_PREFIXES.tvMovie.length)),
      }
    }
    const body = await this.get({
      path: itemPath({ type: ITEM_TYPES.movie, tmdbId }),
      params: {
        append_to_response: 'images',
        include_image_language: this.imageLanguages,
      },
    })
    return toMovieExtras({ body, language: this.language })
  }

  /**
   * Only a show's logo, for a show stored before raven kept them: its
   * pictures, in one call, and no credits, seasons or reviews.
   */
  async showLogo(tmdbId: string): Promise<string | null> {
    const body = await this.get({
      path: `${itemPath({ type: ITEM_TYPES.show, tmdbId })}/images`,
      params: { include_image_language: this.imageLanguages },
    })
    return toLogo({ body, language: this.language })
  }

  async movie(tmdbId: string): Promise<FetchedItem> {
    if (isTvMovieId(tmdbId)) {
      const show = await this.show(tmdbId.slice(TMDB_MATCH_PREFIXES.tvMovie.length))
      // TV runtimes describe an episode, not the combined movie file.
      return { ...show, type: ITEM_TYPES.movie, tmdbId, ended: null, runtime: null }
    }
    const body = await this.get({
      path: itemPath({ type: ITEM_TYPES.movie, tmdbId }),
      params: {
        append_to_response: 'credits,release_dates,external_ids,reviews,images',
        include_image_language: this.imageLanguages,
      },
    })
    const movie = toMovie({ body, country: this.config.metadataCountry, language: this.language })
    if (!movie) throw unreadable(`movie ${tmdbId}`)
    return movie
  }

  /** A person and every movie and show TMDB credits them on, in one call. */
  async person(tmdbId: string): Promise<FetchedPerson> {
    const body = await this.get({
      path: `/person/${encodeURIComponent(tmdbId)}`,
      params: { append_to_response: 'combined_credits,external_ids' },
    })
    const found = toPerson(body)
    if (!found) throw unreadable(`person ${tmdbId}`)
    return found
  }
}
