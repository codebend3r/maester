import { Inject, Injectable } from '@nestjs/common'
import { isBoolean, isRecord } from '@raven/core'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { serviceRequest, textAt } from '@/music/serviceJson'
import { type RateLimit, createRateLimit } from '@/scanner/concurrency'
import { errorMessage } from '@/errorMessage'

const API = 'https://lrclib.net/api/get'

/** What LRCLIB keeps of a track's lyrics: an LRC file, plain text, either, or neither for an instrumental. */
export type LrclibLyrics = { synced: string | null; plain: string | null }

/** LRCLIB away, or answering what this client cannot read: nothing is learnt, so nothing is cached. */
export class LrclibError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LrclibError'
  }
}

const LRCLIB_FIELDS = {
  synced: 'syncedLyrics',
  plain: 'plainLyrics',
  instrumental: 'instrumental',
} as const

/** LRCLIB's record for a track, as the lyrics it holds. */
const toLrclibLyrics = (body: unknown): LrclibLyrics | null => {
  if (!isRecord(body)) return null
  const instrumental = body[LRCLIB_FIELDS.instrumental]
  if (isBoolean(instrumental) && instrumental) return { synced: null, plain: null }
  return { synced: textAt(body[LRCLIB_FIELDS.synced]), plain: textAt(body[LRCLIB_FIELDS.plain]) }
}

type LrclibClientLyricsProps = {
  artist: string
  track: string
  album: string
  /** The track's length in seconds; LRCLIB takes a record within two seconds of it. */
  duration: number
}

/**
 * LRCLIB's lyrics database, which needs no key and asks for a
 * `User-Agent` that names the client. One rate limit for the whole server,
 * two calls a second, ten seconds a call; the caller keeps what it says, so
 * a track is asked for once.
 */
@Injectable()
export class LrclibClient {
  private readonly limit: RateLimit = createRateLimit({ perSecond: 2, inFlight: 1 })

  constructor(@Inject(METADATA_FETCH) private readonly fetch: MetadataFetch) {}

  /** The track's lyrics, or null when LRCLIB has no record of it. */
  async lyrics({
    artist,
    track,
    album,
    duration,
  }: LrclibClientLyricsProps): Promise<LrclibLyrics | null> {
    const query = new URLSearchParams({
      artist_name: artist,
      track_name: track,
      album_name: album,
      duration: String(Math.round(duration)),
    })
    const response = await this.limit
      .run(() => serviceRequest({ fetch: this.fetch, url: `${API}?${query.toString()}` }))
      .catch((error: unknown) => {
        throw new LrclibError(`LRCLIB did not answer: ${errorMessage(error)}`)
      })
    if (response.status === 404) return null
    if (!response.ok) throw new LrclibError(`LRCLIB answered ${response.status}.`)
    const lyrics = toLrclibLyrics(await response.json())
    if (lyrics === null) throw new LrclibError('LRCLIB sent an unreadable record.')
    return lyrics
  }
}
