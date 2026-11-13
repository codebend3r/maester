import { describe, expect, it } from 'bun:test'
import { AUDIO_CODECS, CONTAINERS, VIDEO_CODECS } from '@raven/core'
import { mediaItemFor } from '@raven/native/testing'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { DOWNLOAD_WAYS } from '@/downloads/downloadEntries'
import { trackWayOf, videoWayOf } from '@/downloads/downloadWays'
import { APP_PLATFORMS } from '@/platform/platform'

const ios = APP_PLATFORMS.ios

describe('videoWayOf', () => {
  it('downloads the original of a file AVPlayer plays for sure', () => {
    const media = mediaItemFor({
      container: CONTAINERS.mp4,
      videoCodec: VIDEO_CODECS.h264,
      videoBitDepth: 8,
      audioCodec: AUDIO_CODECS.aac,
    })
    expect(videoWayOf({ platform: ios, media })).toEqual({ way: DOWNLOAD_WAYS.file })
  })

  it("downloads the server's MP4 copy of an MKV, or of HEVC AVPlayer may refuse under its tag", () => {
    const mkv = mediaItemFor({ container: CONTAINERS.mkv, videoCodec: VIDEO_CODECS.hevc })
    const hevc = mediaItemFor({
      container: CONTAINERS.mp4,
      videoCodec: VIDEO_CODECS.hevc,
      audioCodec: AUDIO_CODECS.aac,
    })
    expect(videoWayOf({ platform: ios, media: mkv })).toEqual({ way: DOWNLOAD_WAYS.copy })
    expect(videoWayOf({ platform: ios, media: hevc })).toEqual({ way: DOWNLOAD_WAYS.copy })
  })

  it('offers none for a video AVPlayer decodes no way, and says why', () => {
    const vp9 = mediaItemFor({ container: CONTAINERS.webm, videoCodec: VIDEO_CODECS.vp9 })
    const way = videoWayOf({ platform: ios, media: vp9 })
    expect(way.way).toBeNull()
    expect('reason' in way && way.reason.startsWith(DOWNLOAD_COPY.cantDownload)).toBe(true)
  })

  it('gives a file not yet probed the benefit of the doubt', () => {
    const unprobed = mediaItemFor({
      container: CONTAINERS.mp4,
      videoCodec: null,
      videoBitDepth: null,
      audioCodec: null,
    })
    expect(videoWayOf({ platform: ios, media: unprobed })).toEqual({ way: DOWNLOAD_WAYS.file })
  })
})

describe('trackWayOf', () => {
  it('downloads the file, or AAC for Opus in WebM, which AVPlayer refuses', () => {
    expect(trackWayOf({ codec: AUDIO_CODECS.flac, container: 'flac' })).toBe(DOWNLOAD_WAYS.file)
    expect(trackWayOf({ codec: null, container: 'mp3' })).toBe(DOWNLOAD_WAYS.file)
    expect(trackWayOf({ codec: AUDIO_CODECS.opus, container: CONTAINERS.webm })).toBe(
      DOWNLOAD_WAYS.transcode,
    )
  })
})
