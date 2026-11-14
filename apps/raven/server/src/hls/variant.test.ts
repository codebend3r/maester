import { PLAYBACK_MODES, VIDEO_CODECS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { videoStringOf } from '@/hls/variant'

describe('videoStringOf', () => {
  const dv5 = { profile: 5, level: 6, blSignalCompatibilityId: 0 }

  it('names a transcode 8-bit H.264 whatever the file is', () => {
    expect(
      videoStringOf({
        mode: PLAYBACK_MODES.transcode,
        videoCodec: VIDEO_CODECS.hevc,
        bitDepth: 10,
        dolbyVision: dv5,
      }),
    ).toBe('avc1.640028')
  })

  it('names a remux by the file’s codec and depth', () => {
    expect(
      videoStringOf({
        mode: PLAYBACK_MODES.remux,
        videoCodec: VIDEO_CODECS.hevc,
        bitDepth: 10,
        dolbyVision: null,
      }),
    ).toBe('hvc1.2.4.L153.B0')
  })

  it('names a remux of Dolby Vision HEVC as dvh1 with its profile and level', () => {
    expect(
      videoStringOf({
        mode: PLAYBACK_MODES.remux,
        videoCodec: VIDEO_CODECS.hevc,
        bitDepth: 10,
        dolbyVision: dv5,
      }),
    ).toBe('dvh1.05.06')
  })

  it('names a remux of Dolby Vision profile 7 as its HDR10 base layer, which every device decodes', () => {
    expect(
      videoStringOf({
        mode: PLAYBACK_MODES.remux,
        videoCodec: VIDEO_CODECS.hevc,
        bitDepth: 10,
        dolbyVision: { profile: 7, level: 6, blSignalCompatibilityId: 6 },
      }),
    ).toBe('hvc1.2.4.L153.B0')
  })

  it('cannot name a remux of a codec HLS has no string for', () => {
    expect(
      videoStringOf({
        mode: PLAYBACK_MODES.remux,
        videoCodec: null,
        bitDepth: null,
        dolbyVision: null,
      }),
    ).toBeNull()
  })
})
