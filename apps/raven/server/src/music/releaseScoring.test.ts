import { ALBUM_TYPES, CONFIDENCE_STRONG } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { aiChoiceOf, aiExplanationOf, aiSearchOf } from '@/music/albumClaude'
import { FALLBACK_ARTISTS } from '@/music/filing'
import type { Release } from '@/music/musicBrainzClient'
import type { AlbumToMatch } from '@/music/musicMatchStore'
import { candidatesOf, scoreRelease, searchesFor } from '@/music/releaseScoring'

const OK_COMPUTER: AlbumToMatch = {
  id: 1,
  title: 'OK Computer',
  artist: 'Radiohead',
  year: 1997,
  trackCount: 12,
  folder: null,
}

const release = (over: Partial<Release> = {}): Release => ({
  mbid: 'rel-1',
  title: 'OK Computer',
  artist: 'Radiohead',
  artists: [{ name: 'Radiohead', mbid: 'art-1' }],
  year: 1997,
  trackCount: 12,
  type: ALBUM_TYPES.album,
  country: 'GB',
  releaseGroupMbid: 'rg-1',
  releaseDate: null,
  label: 'Parlophone',
  isOfficial: true,
  score: 100,
  ...over,
})

describe('AI album cleanup choices', () => {
  const offered = new Set(['rel-1'])

  it('accepts only an offered release', () => {
    expect(aiChoiceOf({ input: { mbid: 'rel-1', reason: 'The credits match.' }, offered })).toEqual(
      {
        mbid: 'rel-1',
        reason: 'The credits match.',
      },
    )
    expect(aiChoiceOf({ input: { mbid: 'invented', reason: 'Guess.' }, offered })).toBeNull()
  })

  it('rejects no choice and malformed answers', () => {
    expect(
      aiChoiceOf({ input: { mbid: null, reason: 'Not enough evidence.' }, offered }),
    ).toBeNull()
    expect(aiChoiceOf({ input: { mbid: 'rel-1' }, offered })).toBeNull()
  })
})

describe('scoreRelease', () => {
  it('is sure of a release with the same title, artist, year and track count', () => {
    expect(scoreRelease({ album: OK_COMPUTER, release: release() })).toBe(100)
  })

  it('stays sure of the same album released a year apart elsewhere, or with a bonus track', () => {
    expect(
      scoreRelease({ album: OK_COMPUTER, release: release({ year: 1998, trackCount: 13 }) }),
    ).toBeGreaterThanOrEqual(CONFIDENCE_STRONG)
  })

  it('is not sure of another title by the artist, or the title by another artist', () => {
    expect(
      scoreRelease({ album: OK_COMPUTER, release: release({ title: 'Kid A', year: 2000 }) }),
    ).toBeLessThan(CONFIDENCE_STRONG)
    expect(
      scoreRelease({
        album: OK_COMPUTER,
        release: release({
          artist: 'A Tribute Band',
          artists: [{ name: 'A Tribute Band', mbid: 'x' }],
        }),
      }),
    ).toBeLessThan(CONFIDENCE_STRONG)
  })

  it('reads a title through case, accents and punctuation, and an artist among several credited', () => {
    expect(
      scoreRelease({
        album: { ...OK_COMPUTER, title: 'ok computer!' },
        release: release({
          artist: 'Radiohead feat. Someone',
          artists: [
            { name: 'Radiohead', mbid: 'art-1' },
            { name: 'Someone', mbid: 'art-2' },
          ],
        }),
      }),
    ).toBe(100)
  })

  it('gives a compilation its artist share for the title alone, as Various Artists is no one', () => {
    const now = { ...OK_COMPUTER, title: 'Now 40', artist: FALLBACK_ARTISTS.various, year: null }
    expect(
      scoreRelease({
        album: now,
        release: release({ title: 'Now 40', artist: 'Various Artists', artists: [], year: null }),
      }),
    ).toBeGreaterThanOrEqual(CONFIDENCE_STRONG)
  })

  it('prefers an official release to a bootleg of the same name', () => {
    const official = scoreRelease({ album: OK_COMPUTER, release: release() })
    const bootleg = scoreRelease({ album: OK_COMPUTER, release: release({ isOfficial: false }) })
    expect(official).toBeGreaterThan(bootleg)
  })
})

describe('scoreRelease for damaged tags', () => {
  it('is sure of the plain release for a tag that names its edition', () => {
    expect(
      scoreRelease({
        album: { ...OK_COMPUTER, title: 'OK Computer (Deluxe Edition) [Explicit]', trackCount: 14 },
        release: release(),
      }),
    ).toBeGreaterThanOrEqual(CONFIDENCE_STRONG)
  })

  it("reads the title and artist off the album's folder when the tags are broken", () => {
    expect(
      scoreRelease({
        album: {
          ...OK_COMPUTER,
          title: 'K Compter',
          artist: 'Unknown Artist',
          folder: { artist: 'Radiohead', title: 'OK Computer', year: 1997 },
        },
        release: release(),
      }),
    ).toBeGreaterThanOrEqual(CONFIDENCE_STRONG)
  })
})

describe('scoreRelease for a near title', () => {
  const canibus: AlbumToMatch = {
    id: 2,
    title: 'B.C. (Before Can-I-Bus)',
    artist: 'Canibus',
    year: 2008,
    trackCount: 15,
    folder: null,
  }
  const twoThousandBc = release({
    title: '2000 B.C. (Before Can-I-Bus)',
    artist: 'Canibus',
    artists: [{ name: 'Canibus', mbid: 'art-3' }],
    year: 2000,
    trackCount: 15,
  })

  it('is sure of a release whose title holds the tag and one word more, by the artist with the track count', () => {
    expect(scoreRelease({ album: canibus, release: twoThousandBc })).toBeGreaterThanOrEqual(
      CONFIDENCE_STRONG,
    )
  })

  it('is sure of a title a typo apart by the artist in its year', () => {
    expect(
      scoreRelease({
        album: { ...OK_COMPUTER, title: 'OK Computr', trackCount: 13 },
        release: release(),
      }),
    ).toBeGreaterThanOrEqual(CONFIDENCE_STRONG)
  })

  it('counts a near title for less than the same title', () => {
    expect(scoreRelease({ album: canibus, release: twoThousandBc })).toBeLessThan(
      scoreRelease({
        album: { ...canibus, title: '2000 B.C. (Before Can-I-Bus)' },
        release: twoThousandBc,
      }),
    )
  })

  it('is not sure of a near title with nothing but the artist beside it', () => {
    expect(
      scoreRelease({ album: canibus, release: { ...twoThousandBc, trackCount: 20 } }),
    ).toBeLessThan(CONFIDENCE_STRONG)
  })

  it('never takes one word inside a longer title, or a title two words longer, as near', () => {
    const greatest = { ...OK_COMPUTER, title: 'Hits', year: null, trackCount: 9 }
    expect(
      scoreRelease({ album: greatest, release: release({ title: 'Greatest Hits', year: null }) }),
    ).toBe(scoreRelease({ album: greatest, release: release({ title: 'Kid A', year: null }) }))
    const volume = { ...OK_COMPUTER, title: 'Greatest Hits', year: null, trackCount: 9 }
    expect(
      scoreRelease({
        album: volume,
        release: release({ title: 'Greatest Hits Volume 2', year: null }),
      }),
    ).toBe(scoreRelease({ album: volume, release: release({ title: 'Kid A', year: null }) }))
  })
})

describe('searchesFor', () => {
  it('searches the tags, then the plain title, then the folder, each once', () => {
    expect(
      searchesFor({
        ...OK_COMPUTER,
        title: 'OK Computer (Bonus Track)',
        folder: { artist: 'Radiohead', title: 'OK Computer', year: 1997 },
      }),
    ).toEqual([
      { album: 'OK Computer (Bonus Track)', artist: 'Radiohead' },
      { album: 'OK Computer', artist: 'Radiohead' },
    ])
    expect(
      searchesFor({
        ...OK_COMPUTER,
        title: 'noop Dogg Presents Bible of Love',
        artist: 'Snoop Dogg',
        folder: { artist: 'Snoop Dogg', title: 'Snoop Dogg Presents Bible of Love', year: 2018 },
      }),
    ).toEqual([
      { album: 'noop Dogg Presents Bible of Love', artist: 'Snoop Dogg' },
      { album: 'Snoop Dogg Presents Bible of Love', artist: 'Snoop Dogg' },
    ])
  })
})

describe('aiSearchOf', () => {
  it('takes a named album, trimmed, with or without an artist', () => {
    expect(aiSearchOf({ album: ' Fijación Oral, Vol. 1 ', artist: 'Shakira' })).toEqual({
      album: 'Fijación Oral, Vol. 1',
      artist: 'Shakira',
    })
    expect(aiSearchOf({ album: 'Now 40', artist: null })).toEqual({ album: 'Now 40', artist: null })
  })

  it('takes nothing for no album, an empty one, or a malformed answer', () => {
    expect(aiSearchOf({ album: null, artist: 'Shakira' })).toBeNull()
    expect(aiSearchOf({ album: '  ', artist: null })).toBeNull()
    expect(aiSearchOf('Fijación Oral')).toBeNull()
  })
})

describe('aiExplanationOf', () => {
  it('takes a reason and a fix, each trimmed', () => {
    expect(
      aiExplanationOf({
        reason: ' Year is 2008; MusicBrainz says 2000. ',
        fix: 'Set the year to 2000.',
      }),
    ).toEqual({ reason: 'Year is 2008; MusicBrainz says 2000.', fix: 'Set the year to 2000.' })
  })

  it('takes nothing when either is empty or missing, or the answer is malformed', () => {
    expect(aiExplanationOf({ reason: '  ', fix: 'Set the year.' })).toBeNull()
    expect(aiExplanationOf({ reason: 'Years differ.' })).toBeNull()
    expect(aiExplanationOf('Years differ.')).toBeNull()
  })
})

describe('candidatesOf', () => {
  it('offers the releases best first, each with its confidence', () => {
    const candidates = candidatesOf({
      album: OK_COMPUTER,
      releases: [
        release({
          mbid: 'live',
          title: 'OK Computer',
          isOfficial: false,
          year: 2001,
          trackCount: 20,
        }),
        release({ mbid: 'first' }),
      ],
    })
    expect(candidates.map(({ mbid, confidence }) => ({ mbid, confidence }))).toEqual([
      { mbid: 'first', confidence: 100 },
      { mbid: 'live', confidence: 75 },
    ])
    expect(candidates[0]).toMatchObject({
      title: 'OK Computer',
      artist: 'Radiohead',
      year: 1997,
      trackCount: 12,
      type: ALBUM_TYPES.album,
      country: 'GB',
    })
  })
})
