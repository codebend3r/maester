import { Inject, Injectable } from '@nestjs/common'
import { isMbid, isNumber, isRecord } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { RAVEN_USER_AGENT } from '@/music/userAgent'
import { type RateLimit, createRateLimit, sleep } from '@/scanner/concurrency'

/** ListenBrainz's labs API, where its similarity datasets are served. */
export const LISTENBRAINZ_LABS = 'https://labs.api.listenbrainz.org'

/**
 * The dataset similar artists are read from: listening sessions over about
 * twenty years, the one ListenBrainz's own artist pages use.
 */
const ALGORITHM =
  'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30'

const TIMEOUT_MS = 10_000

/** How often a 503 or a 429 is waited out before the call gives up. */
const RETRIES = 3

const LB_FIELDS = { mbid: 'artist_mbid', score: 'score' } as const

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
 * server, a 503 or a 429 waited out and the rate halved after one, and ten
 * seconds per call; any other failure throws, and the caller goes on
 * without similar artists.
 */
@Injectable()
export class ListenBrainzClient {
  private readonly limit: RateLimit = createRateLimit({ perSecond: 1, inFlight: 1 })
  constructor(@Inject(METADATA_FETCH) private readonly fetch: MetadataFetch) {}

  /** The artists similar to the one MusicBrainz knows as `mbid`, closest first. */
  async similarArtists(mbid: string): Promise<SimilarArtist[]> {
    const query = new URLSearchParams({ artist_mbids: mbid, algorithm: ALGORITHM })
    const url = `${LISTENBRAINZ_LABS}/similar-artists/json?${query.toString()}`
    const headers = { [HEADERS.accept]: CONTENT_TYPES.json, [HEADERS.userAgent]: RAVEN_USER_AGENT }
    const attempt = async (retriesLeft: number): Promise<unknown> => {
      const response = await this.limit.run(() =>
        this.fetch({ url, init: { headers, signal: AbortSignal.timeout(TIMEOUT_MS) } }),
      )
      if ((response.status === 503 || response.status === 429) && retriesLeft > 0) {
        this.limit.slowDown()
        await sleep(1000)
        return attempt(retriesLeft - 1)
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
