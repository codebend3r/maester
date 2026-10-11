import { Inject, Injectable } from '@nestjs/common'
import { type CreditJob, type ItemType, isNumber, isRecord, isString } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { type RateLimit, createRateLimit } from '@/scanner/concurrency'

/**
 * The slice of `fetch` metadata uses, injected so tests answer for TMDB and
 * OMDb and never touch the network.
 */
export type MetadataFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>

/** The DI token the fetch is provided under. */
export const METADATA_FETCH = Symbol('METADATA_FETCH')

const API = 'https://api.themoviedb.org/3'

/** One call may take this long before it counts as TMDB being down. */
const TIMEOUT_MS = 10_000

/** How often a 429 is waited out before the call gives up. */
const RETRIES = 3

/** TMDB's older API key: 32 hex characters, sent as `api_key` rather than as a bearer token. */
const API_KEY = /^[a-f0-9]{32}$/i

/** The only image paths raven ever fetches: `/abc123.jpg`, nothing that could leave TMDB's CDN. */
export const TMDB_IMAGE_PATH = /^\/[A-Za-z0-9_-]+\.(jpg|png)$/

export type TmdbErrorKind = 'unauthorized' | 'not-found' | 'unavailable'

/** 401 is a wrong token, 404 an id TMDB no longer has, and anything else TMDB being away. */
export class TmdbError extends Error {
  readonly kind: TmdbErrorKind

  constructor({ kind, message }: { kind: TmdbErrorKind; message: string }) {
    super(message)
    this.name = 'TmdbError'
    this.kind = kind
  }
}

export type FetchedCredit = {
  tmdbId: string
  name: string
  /** TMDB's path for their photo. */
  photo: string | null
  job: CreditJob
  role: string | null
}

/** A movie, show, season or episode as TMDB describes it, ready to store. */
export type FetchedItem = {
  type: ItemType
  tmdbId: string
  /** A season's or episode's number. */
  number: number | null
  title: string
  originalTitle: string | null
  year: number | null
  released: string | null
  ended: string | null
  summary: string | null
  tagline: string | null
  contentRating: string | null
  runtime: number | null
  studio: string | null
  genres: string[]
  imdbId: string | null
  tvdbId: string | null
  images: { poster: string | null; backdrop: string | null; still: string | null }
  credits: FetchedCredit[]
  /** TMDB's own score out of 10, when anyone has voted. */
  rating: { value: number; votes: number | null } | null
}

export type SearchResult = {
  tmdbId: string
  title: string
  originalTitle: string | null
  year: number | null
  overview: string | null
  poster: string | null
}

export type TmdbState = {
  state: 'off' | 'ok' | 'failing'
  error: string | null
  lastOk: string | null
}

const text = (value: unknown): string | null =>
  isString(value) && value.trim() !== '' ? value.trim() : null

const number = (value: unknown): number | null => (isNumber(value) ? value : null)

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const records = (value: unknown): Array<Record<string, unknown>> => list(value).filter(isRecord)

const idOf = (value: unknown): string | null =>
  isNumber(value) ? String(value) : isString(value) && value !== '' ? value : null

export const imagePath = (value: unknown): string | null => {
  const path = text(value)
  return path != null && TMDB_IMAGE_PATH.test(path) ? path : null
}

export const yearOf = (date: string | null): number | null => {
  const year = Number(date?.slice(0, 4) ?? '')
  return date != null && /^\d{4}/.test(date) && year > 0 ? year : null
}

/** How many cast members are kept, and how many producers. */
const CAST_LIMIT = 50
const PRODUCER_LIMIT = 10

/** TMDB's crew jobs that raven keeps, and what it files each under. */
const CREW_JOBS: Record<string, CreditJob> = {
  Director: 'director',
  Screenplay: 'writer',
  Writer: 'writer',
  Story: 'writer',
  Novel: 'writer',
  Author: 'writer',
  Characters: 'writer',
  Teleplay: 'writer',
  'Original Story': 'writer',
  Producer: 'producer',
}

const JOB_ORDER: readonly CreditJob[] = [
  'cast',
  'guest',
  'creator',
  'director',
  'writer',
  'producer',
]

/**
 * Credits in page order: billed cast, then directors, writers and producers.
 * Someone with two jobs of one kind ("Screenplay" and "Story") is one credit
 * with the roles joined.
 */
export const mergeCredits = (credits: readonly FetchedCredit[]): FetchedCredit[] => {
  const merged = credits.reduce((byKey, credit) => {
    const key = `${credit.job}:${credit.tmdbId}`
    const existing = byKey.get(key)
    if (!existing) return byKey.set(key, credit)
    const roles = [existing.role, credit.role].filter(
      (role, index, all): role is string => role != null && all.indexOf(role) === index,
    )
    return byKey.set(key, { ...existing, role: roles.length > 0 ? roles.join(' / ') : null })
  }, new Map<string, FetchedCredit>())
  const ordered = [...merged.values()].toSorted(
    (a, b) => JOB_ORDER.indexOf(a.job) - JOB_ORDER.indexOf(b.job),
  )
  const dropped = new Set(
    ordered.filter((credit) => credit.job === 'producer').slice(PRODUCER_LIMIT),
  )
  return ordered.filter((credit) => !dropped.has(credit))
}

const person = (
  entry: Record<string, unknown>,
): { tmdbId: string; name: string; photo: string | null } | null => {
  const tmdbId = idOf(entry.id)
  const name = text(entry.name)
  return tmdbId != null && name != null
    ? { tmdbId, name, photo: imagePath(entry.profile_path) }
    : null
}

export const castCredits = ({
  cast,
  job,
}: {
  cast: unknown
  job: 'cast' | 'guest'
}): FetchedCredit[] =>
  records(cast)
    .toSorted((a, b) => (number(a.order) ?? 0) - (number(b.order) ?? 0))
    .slice(0, CAST_LIMIT)
    .flatMap((entry) => {
      const found = person(entry)
      return found ? [{ ...found, job, role: text(entry.character) }] : []
    })

export const crewCredits = (crew: unknown): FetchedCredit[] =>
  records(crew).flatMap((entry) => {
    const found = person(entry)
    const role = text(entry.job)
    const job = role == null ? undefined : CREW_JOBS[role]
    return found && job ? [{ ...found, job, role }] : []
  })

/**
 * The content rating for `country`, then for the US: the theatrical
 * release's certification first, any other after.
 */
const movieCertification = ({
  releaseDates,
  country,
}: {
  releaseDates: unknown
  country: string
}): { rating: string | null; released: string | null } => {
  const forCountry = (code: string) => {
    const dates = records(
      records(record(releaseDates).results).find((entry) => entry.iso_3166_1 === code)
        ?.release_dates ?? null,
    ).toSorted((a, b) => (number(a.type) === 3 ? -1 : 0) - (number(b.type) === 3 ? -1 : 0))
    return {
      rating:
        dates.map((entry) => text(entry.certification)).find((value) => value != null) ?? null,
      released: text(dates[0]?.release_date ?? null)?.slice(0, 10) ?? null,
    }
  }
  const local = forCountry(country)
  const fallback = country === 'US' ? local : forCountry('US')
  return { rating: local.rating ?? fallback.rating, released: local.released }
}

const tmdbRating = (entry: Record<string, unknown>): FetchedItem['rating'] => {
  const value = number(entry.vote_average)
  const votes = number(entry.vote_count)
  return value != null && votes != null && votes > 0 ? { value, votes } : null
}

/** A movie with its credits, release dates and external ids appended. */
export const toMovie = ({
  body,
  country,
}: {
  body: unknown
  country: string
}): FetchedItem | null => {
  const movie = record(body)
  const tmdbId = idOf(movie.id)
  const title = text(movie.title)
  if (tmdbId == null || title == null) return null
  const primary = text(movie.release_date)
  const certification = movieCertification({ releaseDates: movie.release_dates, country })
  const credits = record(movie.credits)
  return {
    type: 'movie',
    tmdbId,
    number: null,
    title,
    originalTitle: text(movie.original_title),
    year: yearOf(primary),
    released: certification.released ?? primary,
    ended: null,
    summary: text(movie.overview),
    tagline: text(movie.tagline),
    contentRating: certification.rating,
    runtime: number(movie.runtime) || null,
    studio: text(records(movie.production_companies)[0]?.name ?? null),
    genres: records(movie.genres).flatMap((genre) => text(genre.name) ?? []),
    imdbId: text(record(movie.external_ids).imdb_id) ?? text(movie.imdb_id),
    tvdbId: null,
    images: {
      poster: imagePath(movie.poster_path),
      backdrop: imagePath(movie.backdrop_path),
      still: null,
    },
    credits: mergeCredits([
      ...castCredits({ cast: credits.cast, job: 'cast' }),
      ...crewCredits(credits.crew),
    ]),
    rating: tmdbRating(movie),
  }
}

const toSearchResult = (entry: Record<string, unknown>): SearchResult | null => {
  const tmdbId = idOf(entry.id)
  const title = text(entry.title) ?? text(entry.name)
  if (tmdbId == null || title == null) return null
  return {
    tmdbId,
    title,
    originalTitle: text(entry.original_title) ?? text(entry.original_name),
    year: yearOf(text(entry.release_date) ?? text(entry.first_air_date)),
    overview: text(entry.overview),
    poster: imagePath(entry.poster_path),
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Seconds from a `Retry-After` header, capped so a strange answer cannot stall a pass for long. */
const retryAfterMs = (header: string | null): number => {
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : 1000
}

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
    if (this.config.tmdbApiToken == null) return { state: 'off', error: null, lastOk: null }
    return {
      state: this.status.error == null ? 'ok' : 'failing',
      error: this.status.error,
      lastOk: this.status.lastOk,
    }
  }

  /** Back to the full rate, at the start of a pass. */
  newPass(): void {
    this.limit.reset()
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const token = this.config.tmdbApiToken
    if (token == null || this.status.refused) {
      throw new TmdbError({ kind: 'unauthorized', message: 'TMDB is not configured.' })
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
      ? { accept: 'application/json' }
      : { accept: 'application/json', authorization: `Bearer ${token}` }

    const attempt = async (retriesLeft: number): Promise<unknown> => {
      const response = await this.limit
        .run(() =>
          this.fetch(url, {
            headers,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
        )
        .catch((error: unknown) => {
          const reason =
            error instanceof Error && error.name === 'TimeoutError'
              ? 'TMDB did not answer within 10 seconds.'
              : 'TMDB could not be reached.'
          this.status.error = reason
          throw new TmdbError({ kind: 'unavailable', message: reason })
        })
      if (response.status === 429 && retriesLeft > 0) {
        this.limit.slowDown()
        await sleep(retryAfterMs(response.headers.get('retry-after')))
        return attempt(retriesLeft - 1)
      }
      if (response.status === 401) {
        this.status.refused = true
        this.status.error = 'TMDB refused the token (401). Check TMDB_API_TOKEN and restart.'
        throw new TmdbError({ kind: 'unauthorized', message: this.status.error })
      }
      if (response.status === 404) {
        this.markOk()
        throw new TmdbError({ kind: 'not-found', message: `TMDB has nothing at ${path}.` })
      }
      if (!response.ok) {
        this.status.error = `TMDB answered ${response.status}.`
        throw new TmdbError({ kind: 'unavailable', message: this.status.error })
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
  }: {
    query: string
    year: number | null
  }): Promise<SearchResult[]> {
    const body = await this.get('/search/movie', {
      query,
      include_adult: 'false',
      ...(year == null ? {} : { year: String(year) }),
    })
    return records(record(body).results).flatMap((entry) => toSearchResult(entry) ?? [])
  }

  /** TMDB's ids for an IMDb or TVDB id, by kind. */
  async find({
    id,
    source,
  }: {
    id: string
    source: 'imdb_id' | 'tvdb_id'
  }): Promise<{ movies: string[]; shows: string[] }> {
    const body = record(
      await this.get(`/find/${encodeURIComponent(id)}`, { external_source: source }),
    )
    const ids = (results: unknown): string[] =>
      records(results).flatMap((entry) => idOf(entry.id) ?? [])
    return { movies: ids(body.movie_results), shows: ids(body.tv_results) }
  }

  async movie(tmdbId: string): Promise<FetchedItem> {
    const body = await this.get(`/movie/${encodeURIComponent(tmdbId)}`, {
      append_to_response: 'credits,release_dates,external_ids',
    })
    const movie = toMovie({ body, country: this.config.metadataCountry })
    if (!movie) {
      throw new TmdbError({
        kind: 'unavailable',
        message: `TMDB sent an unreadable movie ${tmdbId}.`,
      })
    }
    return movie
  }
}
