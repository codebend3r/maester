import { ALBUM_TYPES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import type { AudioTags } from '@/music/audioReader'
import { FALLBACK_ARTISTS, albumTypeOf, filingOf, nameKeyOf } from '@/music/filing'

const NO_TAGS: AudioTags = {
  title: null,
  artists: [],
  album: null,
  albumArtists: [],
  trackNumber: null,
  disc: null,
  year: null,
  originalYear: null,
  genres: [],
  isCompilation: false,
  label: null,
  isrc: null,
  recordingMbid: null,
  releaseMbid: null,
  releaseGroupMbid: null,
  artistMbids: [],
  albumArtistMbids: [],
  releaseTypes: [],
  replayGain: { trackGain: null, trackPeak: null, albumGain: null, albumPeak: null },
  hasCover: false,
}

describe('nameKeyOf', () => {
  it('finds a name again whatever its case, accents and spacing', () => {
    expect(nameKeyOf('Björk')).toBe('bjork')
    expect(nameKeyOf('  THE  Beatles ')).toBe('the beatles')
    expect(nameKeyOf('Sigur Rós')).toBe(nameKeyOf('sigur ros'))
  })
})

describe('albumTypeOf', () => {
  it('reads the strongest release type, and a compilation flag with no types', () => {
    expect(albumTypeOf({ releaseTypes: ['album', 'soundtrack'], isCompilation: false })).toBe(
      ALBUM_TYPES.soundtrack,
    )
    expect(albumTypeOf({ releaseTypes: ['album', 'live'], isCompilation: false })).toBe(
      ALBUM_TYPES.live,
    )
    expect(albumTypeOf({ releaseTypes: ['ep'], isCompilation: false })).toBe(ALBUM_TYPES.ep)
    expect(albumTypeOf({ releaseTypes: [], isCompilation: true })).toBe(ALBUM_TYPES.compilation)
    expect(albumTypeOf({ releaseTypes: [], isCompilation: false })).toBe(ALBUM_TYPES.album)
  })
})

describe('filingOf', () => {
  const path = '/music/Radiohead/Radiohead - OK Computer (1997)/02 - Paranoid Android.flac'

  it('files a tagged file by its release id, under its album artist', () => {
    const filing = filingOf({
      tags: {
        ...NO_TAGS,
        title: 'Paranoid Android',
        artists: ['Radiohead'],
        album: 'OK Computer',
        albumArtists: ['Radiohead'],
        releaseMbid: 'rel-1',
        artistMbids: ['art-1'],
      },
      path,
    })
    expect(filing).toEqual({
      albumKey: 'mbid:rel-1',
      albumTitle: 'OK Computer',
      albumArtists: [{ name: 'Radiohead', mbid: null }],
      isAlbumCredited: true,
      trackArtists: [{ name: 'Radiohead', mbid: 'art-1' }],
      trackTitle: 'Paranoid Android',
    })
  })

  it('files a file with no ids by its album artist and album, and the track under the album artists when it names none of its own', () => {
    const filing = filingOf({
      tags: { ...NO_TAGS, album: 'OK Computer', albumArtists: ['Radiohead'] },
      path,
    })
    expect(filing.albumKey).toBe('name:radiohead:ok computer')
    expect(filing.trackArtists).toEqual([{ name: 'Radiohead', mbid: null }])
    expect(filing.trackTitle).toBe('02 - Paranoid Android')
  })

  it('files a file with no album tag by its folder: the folder is the album, the one above the artist', () => {
    const filing = filingOf({ tags: NO_TAGS, path })
    expect(filing).toEqual({
      albumKey: 'folder:/music/Radiohead/Radiohead - OK Computer (1997)',
      albumTitle: 'Radiohead - OK Computer (1997)',
      albumArtists: [{ name: 'Radiohead', mbid: null }],
      isAlbumCredited: false,
      trackArtists: [{ name: 'Radiohead', mbid: null }],
      trackTitle: '02 - Paranoid Android',
    })
  })

  it('files a compilation with no album artist under Various Artists, keeping each track its own', () => {
    const filing = filingOf({
      tags: { ...NO_TAGS, album: 'Now 40', artists: ['Blur'], isCompilation: true },
      path: '/music/Now 40/01 - Song 2.mp3',
    })
    expect(filing.albumArtists).toEqual([{ name: FALLBACK_ARTISTS.various, mbid: null }])
    expect(filing.trackArtists).toEqual([{ name: 'Blur', mbid: null }])
    expect(filing.albumKey).toBe('name:various artists:now 40')
  })

  it('pairs ids with names only when the tags list as many of each', () => {
    const filing = filingOf({
      tags: { ...NO_TAGS, artists: ['A', 'B'], artistMbids: ['a-1'] },
      path: '/music/x.mp3',
    })
    expect(filing.trackArtists).toEqual([
      { name: 'A', mbid: null },
      { name: 'B', mbid: null },
    ])
  })
})
