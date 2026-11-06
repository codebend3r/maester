import { describe, expect, it } from 'bun:test'
import { CONTAINERS, HLS_COPY_AUDIO_CODECS, PLAYBACK_MODES, VIDEO_CODECS } from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'

import {
  QUALITY_CHOICES,
  pickedQualityOf,
  qualityKeyOf,
  qualityOptionsOf,
} from '@/player/qualityOptions'

const { direct, remux, transcode } = PLAYBACK_MODES

/** A 4K HEVC MKV at 40 Mb/s. */
const UHD_HEVC = mediaItemFor({
  container: CONTAINERS.mkv,
  videoCodec: VIDEO_CODECS.hevc,
  videoBitDepth: 10,
  audioCodec: HLS_COPY_AUDIO_CODECS.eac3,
  height: 2160,
  bitrate: 40_000_000,
})

/** A 720p file at 3.5 Mb/s: no 1080p size, and only the 720p ones under its bitrate. */
const HD_720 = mediaItemFor({
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.h264,
  videoBitDepth: 8,
  audioCodec: HLS_COPY_AUDIO_CODECS.aac,
  height: 720,
  bitrate: 3_500_000,
})

describe('the quality picker', () => {
  it('offers a 4K file direct play, then every size up to the server cap, largest first', () => {
    const options = qualityOptionsOf({
      media: UHD_HEVC,
      modes: [direct, remux, transcode],
      maxHeight: 1080,
    })
    expect(options).toEqual([
      { key: QUALITY_CHOICES.direct, label: 'Direct play (Original quality) · 40.0 Mb/s' },
      { key: 'high1080', label: '1080p HD (High) · 20.0 Mb/s' },
      { key: 'medium1080', label: '1080p HD (Medium) · 12.0 Mb/s' },
      { key: 'standard1080', label: '1080p HD (Standard) · 10.0 Mb/s' },
      { key: 'low1080', label: '1080p HD (Low) · 8.0 Mb/s' },
      { key: 'high720', label: '720p HD (High) · 4.0 Mb/s' },
      { key: 'medium720', label: '720p HD (Medium) · 3.0 Mb/s' },
      { key: 'low720', label: '720p HD · 2.0 Mb/s' },
      { key: 'sd480', label: '480p · 1.5 Mb/s' },
      { key: 'mobile328', label: '328p · 700 kb/s' },
    ])
  })

  it('offers only the sizes smaller than the file, in frame and in bitrate', () => {
    const keys = qualityOptionsOf({
      media: HD_720,
      modes: [direct, transcode],
      maxHeight: 2160,
    }).map((option) => option.key)
    expect(keys).toEqual([QUALITY_CHOICES.direct, 'medium720', 'low720', 'sd480', 'mobile328'])
  })

  it("puts Direct play first, at the file's own bitrate, whatever the plan starts with", () => {
    const first = qualityOptionsOf({ media: UHD_HEVC, modes: [transcode], maxHeight: 1080 })[0]
    expect(first).toEqual({
      key: QUALITY_CHOICES.direct,
      label: 'Direct play (Original quality) · 40.0 Mb/s',
    })
  })

  it('offers no size where the plan holds no transcode, leaving the original alone', () => {
    expect(
      qualityOptionsOf({
        media: UHD_HEVC,
        modes: [direct, remux],
        maxHeight: 1080,
      }),
    ).toEqual([
      { key: QUALITY_CHOICES.direct, label: 'Direct play (Original quality) · 40.0 Mb/s' },
    ])
  })

  it('marks Direct play while the file plays as it is, a size while converted to it, else none', () => {
    expect(qualityKeyOf({ mode: direct, quality: null })).toBe(QUALITY_CHOICES.direct)
    expect(qualityKeyOf({ mode: transcode, quality: 'low720' })).toBe('low720')
    expect(qualityKeyOf({ mode: remux, quality: null })).toBe('')
    expect(qualityKeyOf({ mode: transcode, quality: null })).toBe('')
    expect(pickedQualityOf('low720')).toBe('low720')
    expect(pickedQualityOf(QUALITY_CHOICES.direct)).toBeNull()
  })
})
