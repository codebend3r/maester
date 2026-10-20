import { describe, expect, it } from 'bun:test'
import { type MediaTracks, PLAYBACK_MODES, SUBTITLE_SOURCES, type SubtitleTrack } from '@raven/core'

import {
  SUBTITLES_OFF,
  audioOptionsOf,
  audioPlaceFor,
  subtitleOptionsOf,
} from '@/player/playerTracks'

const subtitle = (track: Partial<SubtitleTrack> & Pick<SubtitleTrack, 'id'>): SubtitleTrack => ({
  source: SUBTITLE_SOURCES.embedded,
  codec: 'mov_text',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...track,
})

const ENGLISH = subtitle({ id: 'embedded-0' })
const PICTURES = subtitle({ id: 'embedded-1', codec: 'hdmv_pgs_subtitle', supported: false })
const FRENCH = subtitle({ id: 'embedded-2', language: 'fr' })
const SIDECAR = subtitle({ id: 'external-0', source: SUBTITLE_SOURCES.external, codec: 'srt' })
const UNTAGGED = subtitle({
  id: 'external-1',
  source: SUBTITLE_SOURCES.external,
  codec: 'srt',
  language: null,
})

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'ac3', channels: 6, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: 'ja', title: 'Commentary', default: false },
  ],
  subtitles: [ENGLISH, PICTURES, FRENCH, SIDECAR, UNTAGGED],
  defaultAudio: 0,
  frameRate: 24,
}

describe('the track pickers', () => {
  it("lists the file's audio tracks by language and details", () => {
    expect(audioOptionsOf(TRACKS)).toEqual([
      { key: '0', label: 'English · Dolby Digital · 5.1' },
      { key: '1', label: 'Japanese · Commentary · AAC · Stereo' },
    ])
  })

  it('offers subtitles off, then every track a player can show', () => {
    expect(subtitleOptionsOf(TRACKS).map(({ key }) => key)).toEqual([
      SUBTITLES_OFF,
      ENGLISH.id,
      FRENCH.id,
      SIDECAR.id,
      UNTAGGED.id,
    ])
  })
})

describe('audioPlaceFor', () => {
  it("picks a file's own audio track in direct play by its place among the player's", () => {
    expect(audioPlaceFor({ mode: PLAYBACK_MODES.direct, tracks: TRACKS, audio: 1 })).toBe(1)
    expect(audioPlaceFor({ mode: PLAYBACK_MODES.direct, tracks: TRACKS, audio: 7 })).toBeNull()
  })

  it("leaves the file's default to the player, and a stream to the track it carries", () => {
    expect(audioPlaceFor({ mode: PLAYBACK_MODES.direct, tracks: TRACKS, audio: null })).toBeNull()
    expect(audioPlaceFor({ mode: PLAYBACK_MODES.remux, tracks: TRACKS, audio: 1 })).toBeNull()
  })
})
