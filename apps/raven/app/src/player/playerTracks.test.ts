import { describe, expect, it } from 'bun:test'
import {
  AUDIO_CODECS,
  type MediaTracks,
  PICTURE_SUBTITLES,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
} from '@raven/core'

import {
  type PictureWays,
  SUBTITLE_CHOICES,
  audioOptionsOf,
  audioPlaceFor,
  filePlaceFor,
  picturesFor,
  subtitleOptionsOf,
  subtitlePlaceFor,
} from '@/player/playerTracks'
import { SUBTITLE_CODECS } from '@/test/subtitleCodecs'

const subtitle = (track: Partial<SubtitleTrack> & Pick<SubtitleTrack, 'id'>): SubtitleTrack => ({
  source: SUBTITLE_SOURCES.embedded,
  codec: SUBTITLE_CODECS.movText,
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...track,
})

const ENGLISH = subtitle({ id: 'embedded-0' })
const PICTURES = subtitle({ id: 'embedded-1', codec: SUBTITLE_CODECS.pgs, supported: false })
/** The same track from a server that reads it into pictures raven can lay over the video. */
const OVERLAID = { ...PICTURES, hasPictureCues: true } satisfies SubtitleTrack

/** Each way a picture track can be shown, alone. */
const NO_WAY = { canDraw: false, canOverlay: false, canBurn: false } as const
const DRAWS = { ...NO_WAY, canDraw: true } as const
const OVERLAYS = { ...NO_WAY, canOverlay: true } as const
const BURNS = { ...NO_WAY, canBurn: true } as const
const FRENCH = subtitle({ id: 'embedded-2', language: 'fr' })
const SIDECAR = subtitle({
  id: 'external-0',
  source: SUBTITLE_SOURCES.external,
  codec: SUBTITLE_CODECS.srt,
})
const UNTAGGED = subtitle({
  id: 'external-1',
  source: SUBTITLE_SOURCES.external,
  codec: SUBTITLE_CODECS.srt,
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

  it('offers subtitles off, then every text track, and no picture track where pictures are hidden', () => {
    expect(subtitleOptionsOf({ tracks: TRACKS, ways: NO_WAY }).map(({ key }) => key)).toEqual([
      SUBTITLE_CHOICES.off,
      ENGLISH.id,
      FRENCH.id,
      SIDECAR.id,
      UNTAGGED.id,
    ])
  })

  it("adds the file's picture tracks, in the file's order, where the player draws them", () => {
    expect(subtitleOptionsOf({ tracks: TRACKS, ways: DRAWS }).map(({ key }) => key)).toEqual([
      SUBTITLE_CHOICES.off,
      ENGLISH.id,
      PICTURES.id,
      FRENCH.id,
      SIDECAR.id,
      UNTAGGED.id,
    ])
  })

  it('offers a picture track raven can lay over the video only when the server reads it into pictures', () => {
    const keysOf = (pictures: SubtitleTrack) =>
      subtitleOptionsOf({
        tracks: { ...TRACKS, subtitles: [ENGLISH, pictures] },
        ways: OVERLAYS,
      }).map(({ key }) => key)
    expect(keysOf(OVERLAID)).toEqual([SUBTITLE_CHOICES.off, ENGLISH.id, OVERLAID.id])
    expect(keysOf(PICTURES)).toEqual([SUBTITLE_CHOICES.off, ENGLISH.id])
  })

  it('names a picture track by its language alone, however it is shown', () => {
    const labelOf = (ways: PictureWays) =>
      subtitleOptionsOf({ tracks: TRACKS, ways }).find(({ key }) => key === PICTURES.id)?.label
    expect(labelOf(DRAWS)).toBe('English')
    expect(labelOf(BURNS)).toBe('English')
  })

  it('labels each subtitle by its language, adding SDH and nothing else', () => {
    const tracks: MediaTracks = {
      ...TRACKS,
      subtitles: [
        subtitle({ id: 'embedded-0', title: 'Full', forced: true }),
        subtitle({ id: 'embedded-1', language: 'fr', hearingImpaired: true }),
        SIDECAR,
        UNTAGGED,
      ],
    }
    expect(subtitleOptionsOf({ tracks, ways: NO_WAY }).map(({ label }) => label)).toEqual([
      'Off',
      'English',
      'French · SDH',
      'English',
      'Unknown language',
    ])
  })
})

describe('picturesFor', () => {
  it('draws where the player can, burns where a transcode can, and hides otherwise', () => {
    const track = PICTURES
    expect(picturesFor({ track, ...BURNS, canDraw: true })).toBe(PICTURE_SUBTITLES.drawn)
    expect(picturesFor({ track, ...BURNS })).toBe(PICTURE_SUBTITLES.burned)
    expect(picturesFor({ track, ...NO_WAY })).toBe(PICTURE_SUBTITLES.hidden)
  })

  it('lays a track the server reads into pictures over the video, in place of a burn', () => {
    const ways = { ...BURNS, canOverlay: true }
    expect(picturesFor({ track: OVERLAID, ...ways })).toBe(PICTURE_SUBTITLES.drawn)
    expect(picturesFor({ track: OVERLAID, ...OVERLAYS })).toBe(PICTURE_SUBTITLES.drawn)
    // A picture track the server cannot read (VobSub, or an older server) is still burned in.
    expect(picturesFor({ track: PICTURES, ...ways })).toBe(PICTURE_SUBTITLES.burned)
    expect(picturesFor({ track: OVERLAID, ...BURNS })).toBe(PICTURE_SUBTITLES.burned)
  })
})

describe('filePlaceFor', () => {
  it("places a track among the file's own subtitle tracks, text and pictures alike", () => {
    expect(filePlaceFor({ tracks: TRACKS, subtitle: PICTURES.id })).toBe(1)
    expect(filePlaceFor({ tracks: TRACKS, subtitle: FRENCH.id })).toBe(2)
  })

  it('places no sidecar, which the file does not hold', () => {
    expect(filePlaceFor({ tracks: TRACKS, subtitle: SIDECAR.id })).toBeNull()
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
