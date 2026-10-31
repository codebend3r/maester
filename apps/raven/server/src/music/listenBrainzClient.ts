import { Inject, Injectable } from '@nestjs/common'
import { isMbid, isNumber, isRecord } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { CLOCK, type Clock } from '@/clock'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { RAVEN_USER_AGENT } from '@/music/userAgent'
import { type RateLimit, createRateLimit, sleep } from '@/scanner/concurrency'

/** ListenBrainz's labs API, where its similarity datasets are served. */
export const LISTENBRAINZ_LABS = 'https://labs.api.listenbrainz.org'

/** ListenBrainz's core API, where listens are submitted and user tokens checked. */
export const LISTENBRAINZ_API = 'https://api.listenbrainz.org'

/** The labs API's routes this client asks. */
export const LISTENBRAINZ_LABS_ROUTES = { similarArtists: '/similar-artists/json' } as const

/**
 * The dataset similar artists are read from: listening sessions over about
 * twenty years, the one ListenBrainz's own artist pages use.
 */
const ALGORITHM =
  'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30'

/** How long one call may take before ListenBrainz counts as away; a test gives less. */
export const DEFAULT_LISTENBRAINZ_TIMEOUT_MS = 5_000

/** The DI token the call's timeout is provided under. */
export const LISTENBRAINZ_TIMEOUT_MS = Symbol('LISTENBRAINZ_TIMEOUT_MS')

/** How long ListenBrainz is left alone after it timed out, refused with a 429 or failed with a 5xx. */
export const LISTENBRAINZ_AWAY_MS = 15 * 60 * 1000

/** How often a 503 is asked again before ListenBrainz counts as away. */
const RETRIES = 1

/** The fields of a similar artist ListenBrainz answers that the client reads. */
export const LB_FIELDS = { mbid: 'artist_mbid', score: 'score' } as const

/** The similar-artists query's parameters. */
export const LB_PARAMS = { artists: 'artist_mbids', algorithm: 'algorithm' } as const

/** An artist ListenBrainz finds similar: its MusicBrainz id, and how strongly, higher being closer. */
export type SimilarArtist = { mbid: string; score: number }

const toSimilar = (value: unknown): SimilarArtist[] => {
  if (!isRecord(value)) return []
  const mbid = value[LB_FIELDS.mbid]
  const score = value[LB_FIELDS.score]
  return isMbid(mbid) && isNumber(score) ? [{ mbid: mbid.toLowerCase(), score }] : []
}

/**
 * ListenBrainz, which needs no key for its similarity data but asks for a
 * `User-Agent` that names the client. One request a second for the whole
 * server and five seconds per call. A timeout, a 429 or a 5xx (after one
 * more try for a 503) leaves ListenBrainz away for `LISTENBRAINZ_AWAY_MS`:
 * every call meanwhile, those already waiting their turn included, fails at
 * once without asking, so an outage never holds a radio up. Any failure
 * throws, and the caller goes on without similar artists.
 */
@Injectable()
export class ListenBrainzClient {
  private readonly limit: RateLimit = createRateLimit({ perSecond: 1, inFlight: 1 })
  private readonly state = { awayUntil: -Infinity }

  constructor(
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LISTENBRAINZ_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  /** Whether ListenBrainz failed lately enough to be left alone. */
  get isAway(): boolean {
    return this.clock.now() < this.state.awayUntil
  }

  private away(reason: string): Error {
    this.state.awayUntil = this.clock.now() + LISTENBRAINZ_AWAY_MS
    return new Error(`ListenBrainz is away: ${reason}`)
  }

  /** The artists similar to the one MusicBrainz knows as `mbid`, closest first. */
  async similarArtists(mbid: string): Promise<SimilarArtist[]> {
    const query = new URLSearchParams({
      [LB_PARAMS.artists]: mbid,
      [LB_PARAMS.algorithm]: ALGORITHM,
    })
    const url = `${LISTENBRAINZ_LABS}${LISTENBRAINZ_LABS_ROUTES.similarArtists}?${query.toString()}`
    const headers = { [HEADERS.accept]: CONTENT_TYPES.json, [HEADERS.userAgent]: RAVEN_USER_AGENT }
    const ask = (): Promise<Response> =>
      this.limit.run(() => {
        if (this.isAway) throw new Error('ListenBrainz is away.')
        return this.fetch({ url, init: { headers, signal: AbortSignal.timeout(this.timeoutMs) } })
      })
    const attempt = async (retriesLeft: number): Promise<unknown> => {
      const response = await ask().catch((error: unknown) => {
        if (this.isAway) throw error
        throw this.away(error instanceof Error ? error.message : String(error))
      })
      if (response.status === 503 && retriesLeft > 0) {
        await sleep(1000)
        return attempt(retriesLeft - 1)
      }
      if (response.status === 429 || response.status >= 500) {
        throw this.away(`it answered ${response.status}`)
      }
      if (!response.ok) throw new Error(`ListenBrainz answered ${response.status}.`)
      return response.json()
    }
    const body = await attempt(RETRIES)
    if (!Array.isArray(body)) throw new Error('ListenBrainz sent an unreadable answer.')
    return body
      .flatMap(toSimilar)
      .filter((similar) => similar.mbid !== mbid.toLowerCase())
      .toSorted((a, b) => b.score - a.score)
  }
}
