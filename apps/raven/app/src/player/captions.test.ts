import { describe, expect, it, mock } from 'bun:test'
import {
  HLS_COPY_AUDIO_CODECS,
  type MediaTracks,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
} from '@raven/core'

import { SUBTITLE_CODECS } from '@/test/subtitleCodecs'

/** The two constants the module reads off the player's library, which bun cannot load. */
const TRACK_TYPES = { DISABLED: 'disabled', INDEX: 'index', TITLE: 'title' } as const
const TEXT_TYPES = { VTT: 'text/vtt' } as const

mock.module('react-native-video', () => ({
  SelectedTrackType: TRACK_TYPES,
  TextTrackType: TEXT_TYPES,
}))

const { captionsFor, sidecarIdsOf, sidecarTracksOf } = await import('@/player/captions')

type CaptionsInput = Parameters<typeof captionsFor>[0]

/** What the module answers, loosened so a test can say it in the stand-in constants above. */
const shown = (input: CaptionsInput): unknown => captionsFor(input)

const sidecarsOf = (input: Parameters<typeof sidecarTracksOf>[0]): unknown => sidecarTracksOf(input)

const pickOf = (input: CaptionsInput): unknown => captionsFor(input).textTrack

const subtitleTrack = (overrides: Partial<SubtitleTrack> & Pick<SubtitleTrack, 'id'>) =>
  ({
    source: SUBTITLE_SOURCES.embedded,
    codec: SUBTITLE_CODECS.movText,
    language: 'en',
    title: null,
    default: false,
    forced: false,
    hearingImpaired: false,
    supported: true,
    ...overrides,
  }) satisfies SubtitleTrack

const PICTURES = subtitleTrack({ id: 'embedded-0', codec: SUBTITLE_CODECS.pgs, supported: false })
const TEXT = subtitleTrack({ id: 'embedded-1' })
const SIDECAR = subtitleTrack({
  id: 'external-0',
  source: SUBTITLE_SOURCES.external,
  codec: SUBTITLE_CODECS.srt,
  language: null,
})

const TRACKS: MediaTracks = {
  audio: [
    {
      index: 0,
      codec: HLS_COPY_AUDIO_CODECS.aac,
      channels: 2,
      language: 'en',
      title: null,
      default: true,
    },
  ],
  subtitles: [PICTURES, TEXT, SIDECAR],
  defaultAudio: 0,
  frameRate: 24,
}

const OFF = { type: TRACK_TYPES.DISABLED }

/** Android TV: ExoPlayer draws every subtitle itself. */
const PLAYER_DRAWS = {
  tracks: TRACKS,
  isBurning: false,
  shouldDrawCaptions: false,
  canDrawPictureSubtitles: true,
} as const

/** iPhone, iPad and Apple TV: raven draws the text, and AVPlayer draws no pictures. */
const RAVEN_DRAWS = {
  tracks: TRACKS,
  isBurning: false,
  shouldDrawCaptions: true,
  canDrawPictureSubtitles: false,
} as const

describe('captionsFor where the player draws the subtitles', () => {
  it("picks a text track inside the file by its place among the file's own, pictures counted", () => {
    expect(shown({ ...PLAYER_DRAWS, mode: PLAYBACK_MODES.direct, subtitle: TEXT.id })).toEqual({
      cueTrack: null,
      textTrack: { type: TRACK_TYPES.INDEX, value: 1 },
    })
  })

  it('picks a sidecar by the title it was handed to the player under', () => {
    expect(shown({ ...PLAYER_DRAWS, mode: PLAYBACK_MODES.direct, subtitle: SIDECAR.id })).toEqual({
      cueTrack: null,
      textTrack: { type: TRACK_TYPES.TITLE, value: SIDECAR.id },
    })
  })

  it("picks a stream's rendition by its place among the text tracks", () => {
    expect(shown({ ...PLAYER_DRAWS, mode: PLAYBACK_MODES.remux, subtitle: SIDECAR.id })).toEqual({
      cueTrack: null,
      textTrack: { type: TRACK_TYPES.INDEX, value: 1 },
    })
  })

  it('hands a picture track to the player only while the file plays as it is', () => {
    expect(shown({ ...PLAYER_DRAWS, mode: PLAYBACK_MODES.direct, subtitle: PICTURES.id })).toEqual({
      cueTrack: null,
      textTrack: { type: TRACK_TYPES.INDEX, value: 0 },
    })
    expect(shown({ ...PLAYER_DRAWS, mode: PLAYBACK_MODES.remux, subtitle: PICTURES.id })).toEqual({
      cueTrack: null,
      textTrack: OFF,
    })
  })

  it('draws nothing with subtitles off, a burn running, or the tracks unread', () => {
    const direct = { ...PLAYER_DRAWS, mode: PLAYBACK_MODES.direct }
    expect(pickOf({ ...direct, subtitle: null })).toEqual(OFF)
    expect(pickOf({ ...direct, subtitle: TEXT.id, isBurning: true })).toEqual(OFF)
    expect(pickOf({ ...direct, subtitle: TEXT.id, tracks: null })).toEqual(OFF)
  })
})

describe('captionsFor where raven draws the subtitles', () => {
  it("reads the picked text track's cues and keeps the player's own tracks off, in any mode", () => {
    const modes = [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]
    modes.forEach((mode) => {
      expect(shown({ ...RAVEN_DRAWS, mode, subtitle: SIDECAR.id })).toEqual({
        cueTrack: SIDECAR,
        textTrack: OFF,
      })
    })
  })

  it('draws no picture track, which AVPlayer cannot and raven has no text for', () => {
    expect(shown({ ...RAVEN_DRAWS, mode: PLAYBACK_MODES.direct, subtitle: PICTURES.id })).toEqual({
      cueTrack: null,
      textTrack: OFF,
    })
  })
})

describe('sidecarIdsOf', () => {
  it("names the file's sidecars, and nothing inside the file or unread", () => {
    expect(sidecarIdsOf(TRACKS)).toEqual([SIDECAR.id])
    expect(sidecarIdsOf(null)).toEqual([])
  })
})

describe('sidecarTracksOf', () => {
  const uri = 'https://raven.example/api/media/7/subtitles/external-0?t=abc'

  it("hands the player each sidecar's WebVTT, titled by its id, at the source's own address", () => {
    expect(sidecarsOf({ sidecars: [{ trackId: SIDECAR.id, uri }], tracks: TRACKS })).toEqual([
      { title: SIDECAR.id, language: '', type: TEXT_TYPES.VTT, uri },
    ])
  })

  it('has none for a source that came with none', () => {
    expect(sidecarsOf({ sidecars: [], tracks: TRACKS })).toEqual([])
  })
})
