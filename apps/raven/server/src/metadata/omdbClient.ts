import { Inject, Injectable } from '@nestjs/common'
import { type RatingSource, isRecord, isString } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'

const API = 'https://www.omdbapi.com/'

const TIMEOUT_MS = 10_000

/** A score from OMDb, out of 10 whatever its source counts in. */
export type OmdbScore = { source: RatingSource; value: number }

export type OmdbState = {
  state: 'off' | 'ok' | 'failing'
  error: string | null
  /** Calls made today, against the daily limit. */
  used: number
}

/** OMDb's names for each source, and how its string reads: "7.5/10", "85%", "74/100". */
const SOURCES: Record<string, { source: RatingSource; scale: number }> = {
  'Internet Movie Database': { source: 'imdb', scale: 1 },
  'Rotten Tomatoes': { source: 'rottenTomatoes', scale: 10 },
  Metacritic: { source: 'metacritic', scale: 10 },
}

/** The scores in an OMDb answer, each brought to a mark out of 10. */
export const parseOmdbRatings = (body: unknown): OmdbScore[] => {
  const ratings = isRecord(body) && Array.isArray(body.Ratings) ? body.Ratings : []
  return ratings.flatMap((entry): OmdbScore[] => {
    if (!isRecord(entry) || !isString(entry.Source) || !isString(entry.Value)) return []
    const known = SOURCES[entry.Source]
    const number = Number.parseFloat(entry.Value)
    if (!known || !Number.isFinite(number)) return []
    return [{ source: known.source, value: Math.round((number / known.scale) * 10) / 10 }]
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
export class OmdbClient {
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
  get enabled(): boolean {
    return (
      this.config.omdbApiKey != null &&
      !this.status.refused &&
      this.usedToday() < this.config.omdbDailyLimit
    )
  }

  /** How many calls are left today. */
  remaining(): number {
    return Math.max(0, this.config.omdbDailyLimit - this.usedToday())
  }

  state(): OmdbState {
    if (this.config.omdbApiKey == null) return { state: 'off', error: null, used: 0 }
    return {
      state: this.status.error == null ? 'ok' : 'failing',
      error: this.status.error,
      used: this.usedToday(),
    }
  }

  /** The scores OMDb has for an IMDb id; none when it knows nothing of it. */
  async ratings(imdbId: string): Promise<OmdbScore[]> {
    const key = this.config.omdbApiKey
    if (key == null || !this.enabled) throw new Error('OMDb is not available right now.')
    this.usedToday()
    this.budget.used += 1
    const query = new URLSearchParams({ i: imdbId, apikey: key })
    const response = await this.fetch(`${API}?${query.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: unknown) => {
      this.status.error =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OMDb did not answer within 10 seconds.'
          : 'OMDb could not be reached.'
      throw new Error(this.status.error)
    })
    if (response.status === 401) {
      this.status.refused = true
      this.status.error = 'OMDb refused the key (401). Check OMDB_API_KEY and restart.'
      throw new Error(this.status.error)
    }
    if (!response.ok) {
      this.status.error = `OMDb answered ${response.status}.`
      throw new Error(this.status.error)
    }
    const body: unknown = await response.json().catch(() => null)
    if (isRecord(body) && body.Response === 'False') {
      const reason = isString(body.Error) ? body.Error : 'OMDb said no.'
      // A wrong key answers 200 with an error, as a limit hit does.
      if (/api key/i.test(reason)) {
        this.status.refused = true
        this.status.error = `OMDb refused the key: ${reason} Check OMDB_API_KEY and restart.`
        throw new Error(this.status.error)
      }
      if (/limit/i.test(reason)) {
        this.budget.used = this.config.omdbDailyLimit
        this.status.error = `OMDb's daily limit is spent: ${reason}`
        throw new Error(this.status.error)
      }
      this.status.error = null
      return []
    }
    this.status.error = null
    return parseOmdbRatings(body)
  }
}
