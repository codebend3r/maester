import { Inject, Injectable } from '@nestjs/common'
import { ALBUM_TYPES, type AlbumType, isAlbumType, isNumber, isRecord, isString } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { RAVEN_USER_AGENT } from '@/music/userAgent'
import { type RateLimit, createRateLimit, sleep } from '@/scanner/concurrency'

const API = 'https://musicbrainz.org/ws/2'

/** One call may take this long before it counts as MusicBrainz being down. */
const TIMEOUT_MS = 10_000

/** How often a 503 is waited out before the call gives up. */
const RETRIES = 3

/** How many releases a search asks for. */
const SEARCH_LIMIT = 10

export const MUSICBRAINZ_ERROR_KINDS = {
  notFound: 'not-found',
  unavailable: 'unavailable',
} as const

export type MusicBrainzErrorKind =
  (typeof MUSICBRAINZ_ERROR_KINDS)[keyof typeof MUSICBRAINZ_ERROR_KINDS]

type MusicBrainzErrorProps = { kind: MusicBrainzErrorKind; message: string }

/** 404 is an id MusicBrainz does not have; anything else is MusicBrainz being away. */
export class MusicBrainzError extends Error {
  readonly kind: MusicBrainzErrorKind

  constructor({ kind, message }: MusicBrainzErrorProps) {
    super(message)
    this.name = 'MusicBrainzError'
    this.kind = kind
  }
}

/**
 * A release as a search or a lookup describes it. A search gives every
 * field here, so a sure result needs no lookup after it.
 */
export type Release = {
  mbid: string
  title: string
  /** The credited artists joined as MusicBrainz writes them: "A feat. B". */
  artist: string
  /** The credited artists' names and ids, in order. */
  artists: { name: string; mbid: string }[]
  year: number | null
  trackCount: number | null
  type: AlbumType
  country: string | null
  releaseGroupMbid: string | null
  label: string | null
  /** Whether MusicBrainz lists it as an official release, rather than a bootleg or a promo. */
  isOfficial: boolean
  /** MusicBrainz's own relevance for a search's result, 0 to 100; 100 for a lookup. */
  score: number
}

const MB_FIELDS = {
  releases: 'releases',
  id: 'id',
  title: 'title',
  score: 'score',
  status: 'status',
  date: 'date',
  country: 'country',
  trackCount: 'track-count',
  releaseGroup: 'release-group',
  primaryType: 'primary-type',
  secondaryTypes: 'secondary-types',
  artistCredit: 'artist-credit',
  name: 'name',
  artist: 'artist',
  joinPhrase: 'joinphrase',
  labelInfo: 'label-info',
  label: 'label',
  media: 'media',
} as const

const MB_STATUSES = { official: 'Official' } as const

type AtProps = { record: Record<string, unknown>; key: string }

type ListAtProps = AtProps

/** The list under `key`, or none: MusicBrainz leaves a field out as often as it sends an empty list. */
const listAt = ({ record, key }: ListAtProps): unknown[] => {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

type RecordAtProps = AtProps

/** The record under `key`, or an empty one. */
const recordAt = ({ record, key }: RecordAtProps): Record<string, unknown> => {
  const value = record[key]
  return isRecord(value) ? value : {}
}

/** The year a MusicBrainz date opens with: `1997-05-21`, `1997`, or nothing. */
const yearOf = (date: unknown): number | null => {
  const match = /^(\d{4})/.exec(isString(date) ? date : '')
  return match?.[1] === undefined ? null : Number(match[1])
}

/**
 * What a release is, from its group's primary and secondary types as
 * MusicBrainz capitalises them; the secondary word wins, as a live
 * soundtrack is listed as a soundtrack.
 */
const typeOf = (group: Record<string, unknown>): AlbumType => {
  const words = [
    ...listAt({ record: group, key: MB_FIELDS.secondaryTypes }),
    group[MB_FIELDS.primaryType],
  ].flatMap((word) => (isString(word) ? [word.toLowerCase()] : []))
  return words.find(isAlbumType) ?? ALBUM_TYPES.album
}

const artistsOf = (
  release: Record<string, unknown>,
): { names: string; list: { name: string; mbid: string }[] } => {
  const parts = listAt({ record: release, key: MB_FIELDS.artistCredit }).filter(isRecord)
  const list = parts.flatMap((part) => {
    const artist = recordAt({ record: part, key: MB_FIELDS.artist })
    const credited = part[MB_FIELDS.name]
    const own = artist[MB_FIELDS.name]
    const ownName = isString(own) ? own : null
    const name = isString(credited) ? credited : ownName
    const mbid = artist[MB_FIELDS.id]
    return name === null || !isString(mbid) ? [] : [{ name, mbid }]
  })
  const names = parts
    .map((part) => {
      const name = isString(part[MB_FIELDS.name]) ? part[MB_FIELDS.name] : ''
      const join = isString(part[MB_FIELDS.joinPhrase]) ? part[MB_FIELDS.joinPhrase] : ''
      return `${name}${join}`
    })
    .join('')
  return { names, list }
}

/** The tracks across a lookup's media, which a search gives as `track-count` outright. */
const trackCountOf = (release: Record<string, unknown>): number | null => {
  const outright = release[MB_FIELDS.trackCount]
  if (isNumber(outright)) return outright
  const counts = listAt({ record: release, key: MB_FIELDS.media }).flatMap((medium) => {
    const count = isRecord(medium) ? medium[MB_FIELDS.trackCount] : null
    return isNumber(count) ? [count] : []
  })
  return counts.length === 0 ? null : counts.reduce((sum, count) => sum + count, 0)
}

/** A release as MusicBrainz's JSON describes it, or null when the record cannot be read. */
export const toRelease = (value: unknown): Release | null => {
  if (!isRecord(value)) return null
  const mbid = value[MB_FIELDS.id]
  const title = value[MB_FIELDS.title]
  if (!isString(mbid) || !isString(title)) return null
  const group = recordAt({ record: value, key: MB_FIELDS.releaseGroup })
  const { names, list } = artistsOf(value)
  const [label] = listAt({ record: value, key: MB_FIELDS.labelInfo }).flatMap((info) => {
    const name = isRecord(info)
      ? recordAt({ record: info, key: MB_FIELDS.label })[MB_FIELDS.name]
      : null
    return isString(name) ? [name] : []
  })
  const country = value[MB_FIELDS.country]
  const groupId = group[MB_FIELDS.id]
  const score = value[MB_FIELDS.score]
  return {
    mbid,
    title,
    artist: names,
    artists: list,
    year: yearOf(value[MB_FIELDS.date]),
    trackCount: trackCountOf(value),
    type: typeOf(group),
    country: isString(country) ? country : null,
    releaseGroupMbid: isString(groupId) ? groupId : null,
    label: label ?? null,
    isOfficial: value[MB_FIELDS.status] === MB_STATUSES.official,
    score: isNumber(score) ? score : 100,
  }
}

/** A Lucene term with its quotes and operators escaped, so a title is searched for as words. */
const quoted = (text: string): string => `"${text.replace(/["\\]/g, (char) => `\\${char}`)}"`

type MusicBrainzClientGetProps = { path: string; params: Record<string, string> }

type MusicBrainzClientSearchReleasesProps = {
  album: string
  /** The album artist; left out for a compilation or when the tags name none. */
  artist: string | null
}

/**
 * MusicBrainz's web service, which needs no key but holds every client to
 * one request a second and a `User-Agent` that names it, or answers 503
 * and may block the address. One rate limit for the whole server, a 503
 * waited out and the rate halved after one, and ten seconds per call.
 */
@Injectable()
export class MusicBrainzClient {
  private readonly limit: RateLimit = createRateLimit({ perSecond: 1, inFlight: 1 })
  constructor(@Inject(METADATA_FETCH) private readonly fetch: MetadataFetch) {}

  private async get({ path, params }: MusicBrainzClientGetProps): Promise<unknown> {
    const query = new URLSearchParams({ ...params, fmt: 'json' })
    const url = `${API}${path}?${query.toString()}`
    const headers = { [HEADERS.accept]: CONTENT_TYPES.json, [HEADERS.userAgent]: RAVEN_USER_AGENT }
    const attempt = async (retriesLeft: number): Promise<unknown> => {
      const response = await this.limit
        .run(() => this.fetch({ url, init: { headers, signal: AbortSignal.timeout(TIMEOUT_MS) } }))
        .catch((error: unknown) => {
          throw new MusicBrainzError({
            kind: MUSICBRAINZ_ERROR_KINDS.unavailable,
            message: `MusicBrainz did not answer: ${error instanceof Error ? error.message : String(error)}`,
          })
        })
      if (response.status === 404) {
        throw new MusicBrainzError({
          kind: MUSICBRAINZ_ERROR_KINDS.notFound,
          message: 'MusicBrainz has no such release.',
        })
      }
      if (response.status === 503 || response.status === 429) {
        this.limit.slowDown()
        if (retriesLeft > 0) {
          await sleep(1000)
          return attempt(retriesLeft - 1)
        }
      }
      if (!response.ok) {
        throw new MusicBrainzError({
          kind: MUSICBRAINZ_ERROR_KINDS.unavailable,
          message: `MusicBrainz answered ${response.status}.`,
        })
      }
      return response.json()
    }
    return attempt(RETRIES)
  }

  /** Releases matching an album's title and artist, MusicBrainz's best first. */
  async searchReleases({
    album,
    artist,
  }: MusicBrainzClientSearchReleasesProps): Promise<Release[]> {
    const terms = [
      `release:${quoted(album)}`,
      ...(artist === null ? [] : [`artist:${quoted(artist)}`]),
    ]
    const body = await this.get({
      path: '/release/',
      params: { query: terms.join(' AND '), limit: String(SEARCH_LIMIT) },
    })
    const releases = isRecord(body) ? listAt({ record: body, key: MB_FIELDS.releases }) : []
    return releases.flatMap((release) => {
      const read = toRelease(release)
      return read === null ? [] : [read]
    })
  }

  /** One release by its id, with its artists, group and labels. */
  async release(mbid: string): Promise<Release> {
    const body = await this.get({
      path: `/release/${encodeURIComponent(mbid)}`,
      params: { inc: 'artist-credits+release-groups+labels+media' },
    })
    const release = toRelease(body)
    if (release === null) {
      throw new MusicBrainzError({
        kind: MUSICBRAINZ_ERROR_KINDS.unavailable,
        message: 'MusicBrainz sent an unreadable release.',
      })
    }
    return release
  }
}
