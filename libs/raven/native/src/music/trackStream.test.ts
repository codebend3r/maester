import { describe, expect, it } from 'bun:test'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  AUDIO_PLATFORMS,
  CONTAINERS,
  TRACK_STREAM_KINDS,
  type Track,
} from '@raven/core'

import { trackStreamOf } from '@/music/trackStream'

const AIRBAG: Track = {
  id: 101,
  libraryId: 5,
  albumId: 7,
  title: 'Airbag',
  disc: 1,
  number: 1,
  duration: 284,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: CONTAINERS.mp4,
  codec: AUDIO_CODECS.flac,
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'v1' },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
}

const ALAC_AIRBAG: Track = { ...AIRBAG, codec: AUDIO_CODECS.alac }

describe('trackStreamOf', () => {
  it('plays the file itself where the player decodes it', () => {
    expect(
      trackStreamOf({ track: AIRBAG, platform: AUDIO_PLATFORMS.android, chosenKbps: null }),
    ).toEqual({ kbps: null, stream: { kind: TRACK_STREAM_KINDS.file } })
  })

  it("plays the server's 256 kbps transcode of a file the player cannot decode", () => {
    expect(
      trackStreamOf({ track: ALAC_AIRBAG, platform: AUDIO_PLATFORMS.android, chosenKbps: null }),
    ).toEqual({
      kbps: AUDIO_BITRATES.standard,
      stream: { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard },
    })
  })

  it("plays the transcode at the listener's chosen bitrate before anything else", () => {
    const chosenKbps = AUDIO_BITRATES.low
    expect(
      trackStreamOf({ track: ALAC_AIRBAG, platform: AUDIO_PLATFORMS.android, chosenKbps }),
    ).toEqual({
      kbps: chosenKbps,
      stream: { kind: TRACK_STREAM_KINDS.transcode, kbps: chosenKbps },
    })
    expect(trackStreamOf({ track: AIRBAG, platform: AUDIO_PLATFORMS.apple, chosenKbps }).kbps).toBe(
      chosenKbps,
    )
  })

  it('lets the player try a track the server has not probed', () => {
    const track = { ...AIRBAG, codec: null }
    expect(
      trackStreamOf({ track, platform: AUDIO_PLATFORMS.apple, chosenKbps: null }).kbps,
    ).toBeNull()
  })
})
