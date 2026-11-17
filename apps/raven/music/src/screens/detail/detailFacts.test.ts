import { describe, expect, it } from 'bun:test'

import { albumMetaOf, artistMetaOf, lengthOf, playlistMetaOf } from '@/screens/detail/detailFacts'

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
  it('reads the genre, the year, the songs and the length', () => {
    const album = { trackCount: 20, duration: 84 * 60, year: 2014 }
    expect(albumMetaOf({ details: { album, genres: ['Pop', 'Rock'] } })).toBe(
      'Pop · 2014 · 20 songs · 1 hr 24 min',
    )
  })

  it('leaves out what the album does not say', () => {
    const album = { trackCount: 3, duration: 900, year: null }
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
