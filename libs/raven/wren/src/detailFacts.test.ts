import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type MusicFact, albumInfoOf, trackInfoOf } from '@raven/core'

import { COVER_FACT_LABELS } from '@/copy/components'
import {
  COVER_FACT_WORDING,
  albumMetaOf,
  artistMetaOf,
  lengthOf,
  playlistMetaOf,
} from '@/detailFacts'
import { AIRBAG, OK_COMPUTER, OK_COMPUTER_PAGE } from '@/testing'

describe('lengthOf', () => {
  it('says hours and minutes', () => {
    expect(lengthOf(84 * 60)).toBe('1 hr 24 min')
  })

  it('says minutes alone under an hour, and hours alone on the hour', () => {
    expect(lengthOf(53 * 60 + 20)).toBe('53 min')
    expect(lengthOf(2 * 60 * 60)).toBe('2 hr')
  })

  it('says nothing under half a minute', () => {
    expect(lengthOf(20)).toBeNull()
  })
})

describe('albumMetaOf', () => {
  it('reads the genre, the release date, the songs and the length', () => {
    const album = { trackCount: 17, duration: 80 * 60, year: 2011, releaseDate: '2011-11-15' }
    expect(albumMetaOf({ details: { album, genres: ['Contemporary R&B'] } })).toBe(
      'Contemporary R&B · November 15, 2011 · 17 songs · 1 hr 20 min',
    )
  })

  it('reads the year when no release date is known', () => {
    const album = { trackCount: 20, duration: 84 * 60, year: 2014, releaseDate: null }
    expect(albumMetaOf({ details: { album, genres: ['Pop', 'Rock'] } })).toBe(
      'Pop · 2014 · 20 songs · 1 hr 24 min',
    )
  })

  it('leaves out what the album does not say', () => {
    const album = { trackCount: 3, duration: 900, year: null, releaseDate: null }
    expect(albumMetaOf({ details: { album, genres: [] } })).toBe('3 songs · 15 min')
  })
})

describe('playlistMetaOf', () => {
  it('counts the songs and the length, and drops a zero', () => {
    expect(playlistMetaOf({ playlist: { trackCount: 2, duration: 600 } })).toBe('2 songs · 10 min')
    expect(playlistMetaOf({ playlist: { trackCount: 0, duration: 0 } })).toBe('')
  })
})

describe('artistMetaOf', () => {
  it('drops a zero count', () => {
    expect(artistMetaOf({ artist: { albumCount: 0, trackCount: 4 } })).toBe('4 songs')
    expect(artistMetaOf({ artist: { albumCount: 8, trackCount: 132 } })).toBe(
      '8 albums · 132 songs',
    )
  })
})

const READ_PAGE = { ...OK_COMPUTER_PAGE, genres: ['Alternative', 'Art rock'], label: 'Parlophone' }

/** A held cover's facts as its sheet labels them. */
const labelled = (facts: readonly MusicFact[]) =>
  facts.map(({ key, value }) => ({ label: COVER_FACT_LABELS[key], value }))

describe('COVER_FACT_WORDING', () => {
  it("says an album's summary before its page is read, and adds the page's facts once it is", () => {
    expect(
      labelled(albumInfoOf({ album: OK_COMPUTER, extras: null, wording: COVER_FACT_WORDING })),
    ).toEqual([
      { label: COVER_FACT_LABELS.released, value: '1997' },
      { label: COVER_FACT_LABELS.tracks, value: '3' },
      { label: COVER_FACT_LABELS.length, value: '15 min' },
    ])
    expect(
      labelled(albumInfoOf({ album: OK_COMPUTER, extras: READ_PAGE, wording: COVER_FACT_WORDING })),
    ).toEqual([
      { label: COVER_FACT_LABELS.released, value: '1997' },
      { label: COVER_FACT_LABELS.genres, value: 'Alternative · Art rock' },
      { label: COVER_FACT_LABELS.label, value: 'Parlophone' },
      { label: COVER_FACT_LABELS.tracks, value: '3' },
      { label: COVER_FACT_LABELS.length, value: '15 min' },
      { label: COVER_FACT_LABELS.format, value: 'FLAC · 16-bit / 44.1 kHz' },
    ])
  })

  it('names a release that is not a plain album first', () => {
    const ep = { ...OK_COMPUTER, type: ALBUM_TYPES.ep, year: null, trackCount: 0, duration: 0 }

    expect(labelled(albumInfoOf({ album: ep, extras: null, wording: COVER_FACT_WORDING }))).toEqual(
      [{ label: COVER_FACT_LABELS.kind, value: 'EP' }],
    )
  })

  it("says a song's album, length and file's format, then its album's date and genres once read", () => {
    expect(
      labelled(
        trackInfoOf({ track: AIRBAG, details: null, quality: null, wording: COVER_FACT_WORDING }),
      ),
    ).toEqual([
      { label: COVER_FACT_LABELS.album, value: OK_COMPUTER.title },
      { label: COVER_FACT_LABELS.length, value: '5:00' },
      { label: COVER_FACT_LABELS.format, value: 'FLAC · 16-bit / 44.1 kHz · 900 kbps' },
    ])
    expect(
      labelled(
        trackInfoOf({
          track: AIRBAG,
          details: READ_PAGE,
          quality: null,
          wording: COVER_FACT_WORDING,
        }),
      ),
    ).toEqual([
      { label: COVER_FACT_LABELS.album, value: OK_COMPUTER.title },
      { label: COVER_FACT_LABELS.released, value: '1997' },
      { label: COVER_FACT_LABELS.genres, value: 'Alternative · Art rock' },
      { label: COVER_FACT_LABELS.length, value: '5:00' },
      { label: COVER_FACT_LABELS.format, value: 'FLAC · 16-bit / 44.1 kHz · 900 kbps' },
    ])
  })
})
