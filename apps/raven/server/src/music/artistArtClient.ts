import { Inject, Injectable, Logger } from '@nestjs/common'
import { isRecord } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { listAt, serviceJson, textAt } from '@/music/serviceJson'
import { type RateLimit, createRateLimit } from '@/scanner/concurrency'

const AUDIO_DB_API = 'https://www.theaudiodb.com/api/v1/json'
const FANART_TV_API = 'https://webservice.fanart.tv/v3/music'

/**
 * TheAudioDB's artist pictures in the order they suit a page background: the 1280x720 fanart
 * first, then the wide thumb, then the square thumb.
 */
const AUDIO_DB_FIELDS = [
  'strArtistFanart',
  'strArtistFanart2',
  'strArtistFanart3',
  'strArtistFanart4',
  'strArtistWideThumb',
  'strArtistThumb',
] as const

/** fanart.tv's artist pictures in the same order: the 1920x1080 backgrounds, then the thumbs. */
const FANART_TV_FIELDS = ['artistbackground', 'artistthumb'] as const

/** The `artists` list TheAudioDB answers with, empty or null for an id it lacks. */
const AUDIO_DB_ARTISTS = 'artists'

/** Where each picture in a fanart.tv list keeps its address. */
const FANART_TV_URL = 'url'

/** The picture addresses in TheAudioDB's artist lookup, in background order. */
const audioDbPicturesOf = (body: unknown): string[] => {
  if (!isRecord(body)) return []
  const [artist] = listAt({ record: body, key: AUDIO_DB_ARTISTS })
  if (!isRecord(artist)) return []
  return AUDIO_DB_FIELDS.flatMap((field) => textAt(artist[field]) ?? [])
}

/** The picture addresses in fanart.tv's artist lookup, in background order: each list's `url`s. */
const fanartTvPicturesOf = (body: unknown): string[] =>
  isRecord(body)
    ? FANART_TV_FIELDS.flatMap((field) =>
        listAt({ record: body, key: field })
          .filter(isRecord)
          .flatMap((picture) => textAt(picture[FANART_TV_URL]) ?? []),
      )
    : []

type JsonOfProps = { url: string; limit: RateLimit; what: string }

/**
 * The artist pictures made for a backdrop, from the two databases that keep them by MusicBrainz
 * id: TheAudioDB, whose free public key serves without signing up (30 calls a minute), and
 * fanart.tv, only with `FANARTTV_API_KEY` set. Either being away or lacking the artist gives
 * none from it, never an error.
 */
@Injectable()
export class ArtistArtClient {
  private readonly logger = new Logger(ArtistArtClient.name)
  private readonly audioDbLimit: RateLimit = createRateLimit({ perSecond: 0.5, inFlight: 1 })
  private readonly fanartTvLimit: RateLimit = createRateLimit({ perSecond: 2, inFlight: 1 })

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
  ) {}

  private async jsonOf({ url, limit, what }: JsonOfProps): Promise<unknown> {
    try {
      return await limit.run(() => serviceJson({ fetch: this.fetch, url }))
    } catch (error) {
      this.logger.warn(`Could not ask ${what}: ${errorMessage(error)}`)
      return null
    }
  }

  private async audioDb(mbid: string): Promise<string[]> {
    const key = encodeURIComponent(this.config.theAudioDbApiKey)
    const query = new URLSearchParams({ i: mbid })
    const body = await this.jsonOf({
      url: `${AUDIO_DB_API}/${key}/artist-mb.php?${query.toString()}`,
      limit: this.audioDbLimit,
      what: `TheAudioDB for artist ${mbid}`,
    })
    return audioDbPicturesOf(body)
  }

  private async fanartTv(mbid: string): Promise<string[]> {
    const key = this.config.fanartTvApiKey
    if (key === null) return []
    const query = new URLSearchParams({ api_key: key })
    const body = await this.jsonOf({
      url: `${FANART_TV_API}/${encodeURIComponent(mbid)}?${query.toString()}`,
      limit: this.fanartTvLimit,
      what: `fanart.tv for artist ${mbid}`,
    })
    return fanartTvPicturesOf(body)
  }

  /** Every backdrop picture both databases hold for the artist, fanart.tv's first, without repeats. */
  async backgrounds(mbid: string): Promise<string[]> {
    const [fanartTv, audioDb] = await Promise.all([this.fanartTv(mbid), this.audioDb(mbid)])
    return [...new Set([...fanartTv, ...audioDb])]
  }
}
