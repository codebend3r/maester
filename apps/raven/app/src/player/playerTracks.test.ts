import { describe, expect, it } from 'bun:test'
import {
  AUDIO_CODECS,
  type MediaTracks,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
} from '@raven/core'

import {
  SUBTITLE_CHOICES,
  audioOptionsOf,
  audioPlaceFor,
  subtitleOptionsOf,
  subtitlePlaceFor,
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
    { index: 0, codec: AUDIO_CODECS.ac3, channels: 6, language: 'en', title: null, default: true },
    {
      index: 1,
      codec: AUDIO_CODECS.aac,
      channels: 2,
      language: 'ja',
      title: 'Commentary',
      default: false,
    },
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
      SUBTITLE_CHOICES.off,
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

describe('subtitlePlaceFor', () => {
  it("picks a stream's rendition by the track's place among the text tracks, pictures left out", () => {
    expect(
      subtitlePlaceFor({ mode: PLAYBACK_MODES.remux, tracks: TRACKS, subtitle: FRENCH.id }),
    ).toBe(1)
    expect(
      subtitlePlaceFor({ mode: PLAYBACK_MODES.transcode, tracks: TRACKS, subtitle: SIDECAR.id }),
    ).toBe(2)
    expect(
      subtitlePlaceFor({ mode: PLAYBACK_MODES.remux, tracks: TRACKS, subtitle: PICTURES.id }),
    ).toBeNull()
  })

  it('leaves the choice to the player with subtitles off, and in direct play, which has none', () => {
    expect(
      subtitlePlaceFor({ mode: PLAYBACK_MODES.remux, tracks: TRACKS, subtitle: null }),
    ).toBeNull()
    expect(
      subtitlePlaceFor({ mode: PLAYBACK_MODES.direct, tracks: TRACKS, subtitle: ENGLISH.id }),
    ).toBeNull()
  })
})
