import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { RAVEN_CONTENT_TYPES } from '@/http'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { FAKE_JPEG } from '@/test/fakeTmdb'

/** The hosts the fake answers for. */
const HOSTS = { musicBrainz: 'musicbrainz.org', coverArt: 'coverartarchive.org' } as const

type FakeRelease = {
  mbid: string
  title: string
  artist: string
  artistMbid?: string
  /** `YYYY-MM-DD` or `YYYY`. */
  date?: string
  trackCount?: number
  /** MusicBrainz's primary type, `Album` when not given, and its secondary types. */
  primaryType?: string
  secondaryTypes?: string[]
  status?: string
  country?: string
  label?: string
  releaseGroupMbid?: string
  /** Whether the Cover Art Archive has a front cover for it. */
  hasCover?: boolean
}

/** A release as MusicBrainz's JSON lists it in a search (with `score` and `track-count`) and a lookup (with `media`). */
type ReleaseBodyProps = { release: FakeRelease; score: number }

const releaseBody = ({ release, score }: ReleaseBodyProps): Record<string, unknown> => ({
  id: release.mbid,
  title: release.title,
  score,
  status: release.status ?? 'Official',
  date: release.date,
  country: release.country,
  'track-count': release.trackCount ?? 10,
  media: [{ 'track-count': release.trackCount ?? 10 }],
  'release-group': {
    id: release.releaseGroupMbid ?? `rg-${release.mbid}`,
    'primary-type': release.primaryType ?? 'Album',
    'secondary-types': release.secondaryTypes ?? [],
  },
  'artist-credit': [
    {
      name: release.artist,
      joinphrase: '',
      artist: { id: release.artistMbid ?? `artist-${release.artist}`, name: release.artist },
    },
  ],
  'label-info': release.label === undefined ? [] : [{ label: { name: release.label } }],
})

type JsonProps = { body: unknown; status?: number }

const json = ({ body, status = 200 }: JsonProps): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
  })

/** The words of a Lucene field, `release:"OK Computer"`, lowercased. */
type TermOfProps = { query: string; field: string }

const termOf = ({ query, field }: TermOfProps): string | null => {
  const match = new RegExp(`${field}:"((?:[^"\\\\]|\\\\.)*)"`).exec(query)
  return match?.[1]?.replace(/\\(.)/g, '$1').toLowerCase() ?? null
}

type FakeMusicBrainzProps = {
  releases: readonly FakeRelease[]
  /** The JPEG the archive serves as every cover; a few bytes that only look like one when left out. */
  cover?: Buffer
}

/**
 * MusicBrainz and the Cover Art Archive as a test's fetch: a search finds
 * the releases whose title contains the asked words (and whose artist does,
 * when one is asked), a lookup finds one by id, and the archive serves a
 * JPEG for a release that has a cover. Every request is remembered.
 */
export const fakeMusicBrainz = ({ releases, cover = FAKE_JPEG }: FakeMusicBrainzProps) => {
  const requests: { url: string; userAgent: string | null }[] = []
  const fetch: MetadataFetch = async ({ url, init }) => {
    const parsed = new URL(url)
    requests.push({ url, userAgent: init.headers[HEADERS.userAgent] ?? null })
    if (parsed.host === HOSTS.coverArt) {
      const [, , mbid] = parsed.pathname.split('/')
      const release = releases.find((each) => each.mbid === mbid)
      return release?.hasCover
        ? new Response(new Uint8Array(cover), {
            headers: { [HEADERS.contentType]: RAVEN_CONTENT_TYPES.jpeg },
          })
        : json({ body: { error: 'No cover art found.' }, status: 404 })
    }
    if (parsed.host !== HOSTS.musicBrainz) return json({ body: { error: 'Not here' }, status: 404 })
    const [, , , entity, id] = parsed.pathname.split('/')
    if (entity !== 'release') return json({ body: { error: 'Not found' }, status: 404 })
    if (id !== undefined && id !== '') {
      const release = releases.find((each) => each.mbid === id)
      return release
        ? json({ body: releaseBody({ release, score: 100 }) })
        : json({ body: { error: 'Not Found' }, status: 404 })
    }
    const query = parsed.searchParams.get('query') ?? ''
    const album = termOf({ query, field: 'release' })
    const artist = termOf({ query, field: 'artist' })
    const found = releases.filter(
      (release) =>
        (album === null || release.title.toLowerCase().includes(album)) &&
        (artist === null || release.artist.toLowerCase().includes(artist)),
    )
    return json({
      body: {
        count: found.length,
        releases: found.map((release, index) => releaseBody({ release, score: 100 - index * 10 })),
      },
    })
  }
  return { fetch, requests }
}
