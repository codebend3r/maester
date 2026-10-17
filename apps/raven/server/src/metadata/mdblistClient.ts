import { Inject, Injectable } from '@nestjs/common'
import {
  type MatchItemType,
  type MetadataServiceState,
  isNumber,
  isRecord,
  isString,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import type { ExternalScore, ScoreSource } from '@/metadata/scoreSources'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { createRateLimit } from '@/scanner/concurrency'

const API = 'https://api.mdblist.com'

const TIMEOUT_MS = 10_000

/** How often a 429 is waited out before the call gives up. */
const RETRIES = 3

/** What MDBList says when the day's calls are spent, as against a burst that only needs a pause. */
const DAILY_LIMIT_ERROR = 'Daily API limit exceeded!'

// The URL, a rating's fields and how an unknown title answers are unconfirmed
// until checked with a key; they live in the next four helpers alone.

const mdblistUrl = ({
  type,
  tmdbId,
  key,
}: {
  type: MatchItemType
  tmdbId: string
  key: string
}): string =>
  `${API}/tmdb/${type}/${encodeURIComponent(tmdbId)}/?${new URLSearchParams({ apikey: key }).toString()}`

/** The `ratings` of an answer, or null when it has none, which is how an unknown title reads. */
const ratingsIn = (body: unknown): unknown[] | null =>
  isRecord(body) && Array.isArray(body.ratings) ? body.ratings : null

/** Whether an answer says MDBList has nothing on the title: a 404, or no `ratings`. */
const isUnknownTitle = ({ status, body }: { status: number; body: unknown }): boolean =>
  status === 404 || ratingsIn(body) == null

/** MDBList's names for each source we keep. Its `score` is 0 to 100 whatever the source counts in. */
const SOURCES = new Map<string, ExternalScore['source']>([
  ['imdb', 'imdb'],
  ['tomatoes', 'rottenTomatoes'],
  ['metacritic', 'metacritic'],
])

/** The scores in an MDBList answer, each brought to a mark out of 10. */
export const parseMdblistRatings = (body: unknown): ExternalScore[] =>
  (ratingsIn(body) ?? []).flatMap((entry): ExternalScore[] => {
    if (!isRecord(entry) || !isString(entry.source) || !isNumber(entry.score)) return []
    const source = SOURCES.get(entry.source)
    if (source == null || entry.score < 0 || entry.score > 100) return []
    return [
      {
        source,
        value: Math.round(entry.score) / 10,
        votes: isNumber(entry.votes) ? entry.votes : null,
      },
    ]
  })

/** Today in UTC, which is when MDBList's daily count resets. */
const today = (): string => new Date().toISOString().slice(0, 10)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Seconds from a `Retry-After` header, capped so a strange answer cannot stall a pass for long. */
const retryAfterMs = (header: string | null): number => {
  // Number(null) and Number('') are 0, which would not wait at all.
  if (header == null || header.trim() === '') return 1000
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : 1000
}

/**
 * MDBList, for IMDb, Rotten Tomatoes and Metacritic scores by TMDB id, which
 * it has for shows where OMDb has none. A free key allows a thousand calls a
 * day, so the client counts its own and stops at the configured limit until
 * midnight UTC; MDBList saying the day is spent does the same. It keeps to 3
 * calls a second with 2 in flight and waits out a burst's 429. A refused key
 * stops calls until a restart.
 */
@Injectable()
export class MdblistClient implements ScoreSource {
  readonly provider = 'mdblist'
  private readonly limit = createRateLimit({ perSecond: 3, inFlight: 2 })
  private readonly budget = { day: today(), used: 0 }
  private readonly status: { error: string | null; refused: boolean } = {
    error: null,
    refused: false,
  }

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
  ) {}

  private usedToday(): number {
    if (this.budget.day !== today()) {
      this.budget.day = today()
      this.budget.used = 0
    }
    return this.budget.used
  }

  enabled(): boolean {
    return (
      this.config.mdblistApiKey != null &&
      !this.status.refused &&
      this.usedToday() < this.config.mdblistDailyLimit
    )
  }

  remaining(): number {
    return Math.max(0, this.config.mdblistDailyLimit - this.usedToday())
  }

  state(): MetadataServiceState {
    if (this.config.mdblistApiKey == null) return 'off'
    return this.status.error == null ? 'ok' : 'failing'
  }

  /** The scores MDBList has for a TMDB id; `'unknown'` when it knows nothing of it. */
  async lookUp({
    type,
    tmdbId,
  }: {
    type: MatchItemType
    tmdbId: string
    imdbId: string | null
  }): Promise<ExternalScore[] | 'unknown'> {
    const key = this.config.mdblistApiKey
    if (key == null || !this.enabled()) throw new Error('MDBList is not available right now.')
    this.budget.used += 1
    const url = mdblistUrl({ type, tmdbId, key })

    const attempt = async (retriesLeft: number): Promise<ExternalScore[] | 'unknown'> => {
      const response = await this.limit
        .run(() =>
          this.fetch({
            url,
            init: {
              headers: { [HEADERS.accept]: CONTENT_TYPES.json },
              signal: AbortSignal.timeout(TIMEOUT_MS),
            },
          }),
        )
        .catch((error: unknown) => {
          this.status.error =
            error instanceof Error && error.name === 'TimeoutError'
              ? 'MDBList did not answer within 10 seconds.'
              : 'MDBList could not be reached.'
          throw new Error(this.status.error)
        })
      if (response.status === 401) {
        this.status.refused = true
        this.status.error = 'MDBList refused the key (401). Check MDBLIST_API_KEY and restart.'
        throw new Error(this.status.error)
      }
      if (response.status === 429) {
        const body: unknown = await response.json().catch(() => null)
        if (isRecord(body) && body.error === DAILY_LIMIT_ERROR) {
          this.budget.used = this.config.mdblistDailyLimit
          this.status.error = `MDBList's daily limit is spent: ${DAILY_LIMIT_ERROR}`
          throw new Error(this.status.error)
        }
        if (retriesLeft > 0) {
          await sleep(retryAfterMs(response.headers.get('retry-after')))
          return attempt(retriesLeft - 1)
        }
      }
      if (response.status !== 404 && !response.ok) {
        this.status.error = `MDBList answered ${response.status}.`
        throw new Error(this.status.error)
      }
      const body: unknown = await response.json().catch(() => null)
      this.status.error = null
      return isUnknownTitle({ status: response.status, body })
        ? 'unknown'
        : parseMdblistRatings(body)
    }

    return attempt(RETRIES)
  }
}
