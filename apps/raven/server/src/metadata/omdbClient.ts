import { Inject, Injectable } from '@nestjs/common'
import {
  METADATA_SERVICE_STATES,
  type MetadataServiceState,
  RATING_SOURCES,
  isRecord,
  isString,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { ERROR_NAMES } from '@/errorMessage'
import {
  type ExternalScore,
  SCORE_ANSWERS,
  SCORE_PROVIDERS,
  type ScoreAnswer,
  type ScoreSource,
  type ScoreTitle,
} from '@/metadata/scoreSources'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'

const API = 'https://www.omdbapi.com/'

/** OMDb's `Response` field, a string, when it has nothing to give. */
const OMDB_RESPONSES = { false: 'False' } as const

const TIMEOUT_MS = 10_000

/** OMDb's names for each source, and how its string reads: "7.5/10", "85%", "74/100". */
const SOURCES: Record<string, { source: ExternalScore['source']; scale: number }> = {
  'Internet Movie Database': { source: RATING_SOURCES.imdb, scale: 1 },
  'Rotten Tomatoes': { source: RATING_SOURCES.rottenTomatoes, scale: 10 },
  Metacritic: { source: RATING_SOURCES.metacritic, scale: 10 },
}

/** The scores in an OMDb answer, each brought to a mark out of 10. */
export const parseOmdbRatings = (body: unknown): ExternalScore[] => {
  const ratings = isRecord(body) && Array.isArray(body.Ratings) ? body.Ratings : []
  return ratings.flatMap((entry): ExternalScore[] => {
    if (!isRecord(entry) || !isString(entry.Source) || !isString(entry.Value)) return []
    const known = SOURCES[entry.Source]
    const number = Number.parseFloat(entry.Value)
    if (!known || !Number.isFinite(number)) return []
    return [
      { source: known.source, value: Math.round((number / known.scale) * 10) / 10, votes: null },
    ]
  })
}

/** Today in UTC, which is when OMDb's daily count resets. */
const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * OMDb, for IMDb, Rotten Tomatoes and Metacritic scores by IMDb id. A free
 * key allows a thousand calls a day, so the client counts its own and stops
 * at the configured limit until midnight UTC; a big library fills over a
 * few days. A refused key stops calls until a restart.
 */
@Injectable()
export class OmdbClient implements ScoreSource {
  readonly provider = SCORE_PROVIDERS.omdb
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

  /** Whether there is a key, it has not been refused, and today's calls are not spent. */
  enabled(): boolean {
    return this.hasUsableKey() && this.usedToday() < this.config.omdbDailyLimit
  }

  /** Whether there is a key it has not had refused, whether or not today's calls are spent. */
  hasUsableKey(): boolean {
    return this.config.omdbApiKey != null && !this.status.refused
  }

  /** How many calls are left today. */
  remaining(): number {
    return Math.max(0, this.config.omdbDailyLimit - this.usedToday())
  }

  state(): MetadataServiceState {
    if (this.config.omdbApiKey == null) return METADATA_SERVICE_STATES.off
    return this.status.error == null ? METADATA_SERVICE_STATES.ok : METADATA_SERVICE_STATES.failing
  }

  /** OMDb is asked by IMDb id, so a title without one is not known to it. */
  async lookUp({ imdbId }: ScoreTitle): Promise<ScoreAnswer> {
    if (imdbId == null) return SCORE_ANSWERS.unknown
    return this.ratings(imdbId)
  }

  /** The scores OMDb has for an IMDb id; none when it knows nothing of it. */
  async ratings(imdbId: string): Promise<ExternalScore[]> {
    const key = this.config.omdbApiKey
    if (key == null || !this.enabled()) throw new Error('OMDb is not available right now.')
    this.usedToday()
    this.budget.used += 1
    const query = new URLSearchParams({ i: imdbId, apikey: key })
    const response = await this.fetch({
      url: `${API}?${query.toString()}`,
      init: {
        headers: { [HEADERS.accept]: CONTENT_TYPES.json },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    }).catch((error: unknown) => {
      this.status.error =
        error instanceof Error && error.name === ERROR_NAMES.timeoutError
          ? 'OMDb did not answer within 10 seconds.'
          : 'OMDb could not be reached.'
      throw new Error(this.status.error)
    })
    if (response.status === 401) {
      // A spent day answers 401 too; only the reason tells it from a wrong key.
      const body: unknown = await response.json().catch(() => null)
      if (isRecord(body) && isString(body.Error) && /limit/i.test(body.Error)) {
        this.spend(body.Error)
      }
      this.status.refused = true
      this.status.error = 'OMDb refused the key (401). Check OMDB_API_KEY and restart.'
      throw new Error(this.status.error)
    }
    if (!response.ok) {
      this.status.error = `OMDb answered ${response.status}.`
      throw new Error(this.status.error)
    }
    const body: unknown = await response.json().catch(() => null)
    if (isRecord(body) && body.Response === OMDB_RESPONSES.false) {
      const reason = isString(body.Error) ? body.Error : 'OMDb said no.'
      // Should a wrong key or a limit hit answer 200, the reason still tells.
      if (/api key/i.test(reason)) {
        this.status.refused = true
        this.status.error = `OMDb refused the key: ${reason} Check OMDB_API_KEY and restart.`
        throw new Error(this.status.error)
      }
      if (/limit/i.test(reason)) this.spend(reason)
      this.status.error = null
      return []
    }
    this.status.error = null
    return parseOmdbRatings(body)
  }

  /** Counts today as used up once OMDb says so, so calls wait for midnight UTC. */
  private spend(reason: string): never {
    this.budget.used = this.config.omdbDailyLimit
    this.status.error = `OMDb's daily limit is spent: ${reason}`
    throw new Error(this.status.error)
  }
}
