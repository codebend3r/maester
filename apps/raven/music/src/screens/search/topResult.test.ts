import { describe, expect, it } from 'bun:test'

import { TOP_RESULT_KINDS, topResultOf } from '@/screens/search/topResult'
import { AIRBAG, OK_COMPUTER, RADIOHEAD } from '@/test/music'

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
