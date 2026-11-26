import { describe, expect, it } from 'bun:test'

import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  AUDIO_PLATFORMS,
  CONTAINERS,
  TRACK_STREAM_KINDS,
} from '@raven/core'
import { AIRBAG } from '@raven/wren/testing'

import { trackRequestOf } from '@/music/trackRequest'

describe('trackRequestOf', () => {
  it('plays the file itself where the TV decodes it', () => {
    const track = { ...AIRBAG, codec: AUDIO_CODECS.flac, container: CONTAINERS.mp4 }
    expect(trackRequestOf({ track, platform: AUDIO_PLATFORMS.android })).toEqual({
      kbps: null,
      stream: { kind: TRACK_STREAM_KINDS.file },
    })
  })

  it("plays the server's transcode of a file Android TV cannot decode", () => {
    const track = { ...AIRBAG, codec: AUDIO_CODECS.alac, container: CONTAINERS.mp4 }
    expect(trackRequestOf({ track, platform: AUDIO_PLATFORMS.android })).toEqual({
      kbps: AUDIO_BITRATES.standard,
      stream: { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard },
    })
  })

  it('lets the player try a track the server has not probed', () => {
    const track = { ...AIRBAG, codec: null }
    expect(trackRequestOf({ track, platform: AUDIO_PLATFORMS.apple }).kbps).toBeNull()
  })
})
