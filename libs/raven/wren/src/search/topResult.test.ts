import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type AlbumSummary, type Artist, MATCH_STATES, type Track } from '@raven/core'

import { TOP_RESULT_KINDS, topResultOf } from '@/search/topResult'
const RADIOHEAD: Artist = {
  id: 1,
  name: 'Radiohead',
  sortName: 'Radiohead',
  mbid: null,
  photoVersion: null,
  albumCount: 1,
  trackCount: 3,
}

const OK_COMPUTER: AlbumSummary = {
  id: 7,
  libraryId: 5,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  releaseDate: null,
  year: 1997,
  type: ALBUM_TYPES.album,
  artists: [{ id: RADIOHEAD.id, name: RADIOHEAD.name }],
  isCompilation: false,
  trackCount: 3,
  duration: 900,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt: '2026-01-01T00:00:00Z',
}

const AIRBAG: Track = {
  id: 101,
  libraryId: 5,
  albumId: OK_COMPUTER.id,
  title: 'Airbag',
  disc: 1,
  number: 1,
  duration: 300,
  artists: [{ id: RADIOHEAD.id, name: RADIOHEAD.name }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: OK_COMPUTER.title, coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
}

const EVERYTHING = { albums: [OK_COMPUTER], artists: [RADIOHEAD], songs: [AIRBAG] }

describe('topResultOf', () => {
  it('picks an artist or an album named exactly what was typed', () => {
    expect(topResultOf({ query: ' radiohead ', ...EVERYTHING })).toEqual({
      kind: TOP_RESULT_KINDS.artist,
      artist: RADIOHEAD,
    })
    expect(topResultOf({ query: OK_COMPUTER.title.toUpperCase(), ...EVERYTHING })).toEqual({
      kind: TOP_RESULT_KINDS.album,
      album: OK_COMPUTER,
    })
  })

  it('else the first song, then the first album, then the first artist', () => {
    expect(topResultOf({ query: 'ok', ...EVERYTHING })).toEqual({
      kind: TOP_RESULT_KINDS.song,
      track: AIRBAG,
    })
    expect(topResultOf({ query: 'ok', ...EVERYTHING, songs: [] })).toEqual({
      kind: TOP_RESULT_KINDS.album,
      album: OK_COMPUTER,
    })
    expect(topResultOf({ query: 'ok', albums: [], artists: [RADIOHEAD], songs: [] })).toEqual({
      kind: TOP_RESULT_KINDS.artist,
      artist: RADIOHEAD,
    })
    expect(topResultOf({ query: 'ok', albums: [], artists: [], songs: [] })).toBeNull()
  })
})
