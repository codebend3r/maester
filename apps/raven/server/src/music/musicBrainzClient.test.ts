import { ALBUM_TYPES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import {
  MUSICBRAINZ_ERROR_KINDS,
  MusicBrainzClient,
  MusicBrainzError,
  toRelease,
} from '@/music/musicBrainzClient'
import { fakeMusicBrainz } from '@/test/fakeMusicBrainz'

describe('toRelease', () => {
  it('reads a release as MusicBrainz writes one: credits joined, types folded, labels and the first medium count', () => {
    expect(
      toRelease({
        id: 'rel-1',
        title: 'OK Computer',
        score: 97,
        status: 'Official',
        date: '1997-05-21',
        country: 'GB',
        'release-group': { id: 'rg-1', 'primary-type': 'Album', 'secondary-types': ['Live'] },
        'artist-credit': [
          { name: 'Radiohead', joinphrase: ' feat. ', artist: { id: 'art-1', name: 'Radiohead' } },
          { name: 'Guest', joinphrase: '', artist: { id: 'art-2', name: 'Guest' } },
        ],
        'label-info': [{ label: { name: 'Parlophone' } }],
        media: [{ 'track-count': 12 }, { 'track-count': 2 }],
      }),
    ).toEqual({
      mbid: 'rel-1',
      title: 'OK Computer',
      artist: 'Radiohead feat. Guest',
      artists: [
        { name: 'Radiohead', mbid: 'art-1' },
        { name: 'Guest', mbid: 'art-2' },
      ],
      year: 1997,
      releaseDate: '1997-05-21',
      trackCount: 14,
      type: ALBUM_TYPES.live,
      country: 'GB',
      releaseGroupMbid: 'rg-1',
      label: 'Parlophone',
      isOfficial: true,
      score: 97,
    })
  })

  it('reads nothing from a record with no id or title, and fills the rest with nulls', () => {
    expect(toRelease({ title: 'No id' })).toBeNull()
    expect(toRelease({ id: 'rel-2', title: 'Bare' })).toMatchObject({
      artist: '',
      artists: [],
      year: null,
      trackCount: null,
      type: ALBUM_TYPES.album,
      country: null,
      releaseGroupMbid: null,
      label: null,
      isOfficial: false,
      score: 100,
    })
  })
})

describe('MusicBrainzClient', () => {
  it('searches by album and artist with a User-Agent that names raven, and reads the releases back', async () => {
    const fake = fakeMusicBrainz({
      releases: [
        { mbid: 'rel-1', title: 'OK Computer', artist: 'Radiohead', date: '1997' },
        { mbid: 'rel-2', title: 'OK Computer', artist: 'A Tribute Band' },
      ],
    })
    const client = new MusicBrainzClient(fake.fetch)
    const found = await client.searchReleases({ album: 'OK Computer', artist: 'Radiohead' })
    expect(found.map(({ mbid }) => mbid)).toEqual(['rel-1'])
    expect(fake.requests[0]?.userAgent).toMatch(
      /^raven\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/codebend3r\/maester\)$/,
    )
    expect(new URL(fake.requests[0]?.url ?? '').searchParams.get('query')).toBe(
      'release:"OK Computer" AND artist:"Radiohead"',
    )
    await expect(client.release('rel-2')).resolves.toMatchObject({ title: 'OK Computer' })
  })

  it('tells an id MusicBrainz lacks from MusicBrainz being away, and waits a 503 out before giving up', async () => {
    const fake = fakeMusicBrainz({ releases: [] })
    const client = new MusicBrainzClient(fake.fetch)
    await expect(client.release('nope')).rejects.toMatchObject({
      kind: MUSICBRAINZ_ERROR_KINDS.notFound,
    })
    const down: MetadataFetch = async () => new Response('busy', { status: 503 })
    const away = new MusicBrainzClient(down)
    const failed = await away
      .searchReleases({ album: 'x', artist: null })
      .catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(MusicBrainzError)
    expect(failed).toMatchObject({ kind: MUSICBRAINZ_ERROR_KINDS.unavailable })
  }, 20_000)
})
