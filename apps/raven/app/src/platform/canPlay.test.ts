import { describe, expect, it } from 'bun:test'
import {
  CONTAINERS,
  DIRECT_PLAYS,
  HLS_COPY_AUDIO,
  HLS_COPY_AUDIO_CODECS,
  type MediaItem,
  PLAYBACK_MODES,
  type PlaybackSettings,
  TRANSCODINGS,
  VIDEO_CODECS,
  planPlayback,
  streamMimeType,
  videoCodecString,
} from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'

import { canPlayFor } from '@/platform/canPlay'
import { APP_PLATFORMS } from '@/platform/platform'

const planOnIos = ({
  media,
  transcoding = TRANSCODINGS.on,
}: {
  media: MediaItem
  transcoding?: PlaybackSettings['transcoding']
}) =>
  planPlayback({
    media,
    ...canPlayFor(APP_PLATFORMS.ios),
    defaultAudio: true,
    policy: { directPlay: DIRECT_PLAYS.auto, transcoding },
  })

/** ffprobe's names for what Apple's table leaves out, which only these files carry. */
const UNLISTED = {
  mkv: 'mkv',
  av1: 'av1',
  truehd: 'truehd',
  opus: 'opus',
  dts: 'dts',
} as const

const MKV_REFUSED = "The MKV container isn't supported here."

describe('canPlayFor on iPhone and iPad', () => {
  it('starts an H.264 AAC MP4 as the original file', () => {
    const media = mediaItemFor({
      container: CONTAINERS.mp4,
      videoCodec: VIDEO_CODECS.h264,
      videoBitDepth: 8,
      audioCodec: HLS_COPY_AUDIO_CODECS.aac,
    })
    expect(planOnIos({ media })).toEqual({
      modes: [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
      problems: [],
    })
  })

  it('starts an HEVC TrueHD MKV at the remux, whose HLS copies the video', () => {
    const media = mediaItemFor({
      container: UNLISTED.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: UNLISTED.truehd,
    })
    expect(planOnIos({ media })).toEqual({
      modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
      problems: [MKV_REFUSED],
    })
  })

  it('tries an HEVC MP4 as it is, since only an hev1 tag refuses, with the remux after it', () => {
    const media = mediaItemFor({
      container: CONTAINERS.mp4,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: HLS_COPY_AUDIO_CODECS.eac3,
    })
    expect(planOnIos({ media }).modes.slice(0, 2)).toEqual([
      PLAYBACK_MODES.direct,
      PLAYBACK_MODES.remux,
    ])
  })

  it('plays every stream the server converts to, since the stereo AAC the planner names is copied as it is', () => {
    const { canStream } = canPlayFor(APP_PLATFORMS.ios)
    const media = mediaItemFor({
      container: UNLISTED.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: UNLISTED.truehd,
    })
    expect(canStream(streamMimeType({ media, mode: PLAYBACK_MODES.remux }))).toBe(true)
    expect(canStream(streamMimeType({ media, mode: PLAYBACK_MODES.transcode }))).toBe(true)
  })

  it('answers for the hvc1 string the remux is re-tagged to', () => {
    const { canStream } = canPlayFor(APP_PLATFORMS.ios)
    const hevc = videoCodecString({ codec: VIDEO_CODECS.hevc, bitDepth: 10 })
    expect(hevc).toStartWith('hvc1.')
    expect(canStream(`video/mp4; codecs="${hevc}"`)).toBe(true)
  })

  it('sends an AV1 MKV through the transcode, since AVPlayer decodes no AV1 here', () => {
    const media = mediaItemFor({
      container: UNLISTED.mkv,
      videoCodec: UNLISTED.av1,
      videoBitDepth: 10,
      audioCodec: UNLISTED.opus,
    })
    expect(planOnIos({ media }).modes).toEqual([PLAYBACK_MODES.transcode])
  })

  it('sends a 10-bit H.264 MKV through the transcode, since AVPlayer has no High 10 decoder', () => {
    const media = mediaItemFor({
      container: UNLISTED.mkv,
      videoCodec: VIDEO_CODECS.h264,
      videoBitDepth: 10,
      audioCodec: HLS_COPY_AUDIO_CODECS.aac,
    })
    expect(planOnIos({ media }).modes).toEqual([PLAYBACK_MODES.transcode])
  })

  it('plays H.264 in MP4 as it is only at 8 bits', () => {
    const planAt = (videoBitDepth: number) =>
      planOnIos({
        media: mediaItemFor({
          container: CONTAINERS.mp4,
          videoCodec: VIDEO_CODECS.h264,
          videoBitDepth,
          audioCodec: HLS_COPY_AUDIO_CODECS.aac,
        }),
      }).modes
    expect(planAt(8)[0] ?? null).toBe(PLAYBACK_MODES.direct)
    expect(planAt(10)).toEqual([PLAYBACK_MODES.transcode])
  })

  it('leaves an MKV no way to play when the server converts nothing', () => {
    const media = mediaItemFor({
      container: UNLISTED.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: HLS_COPY_AUDIO_CODECS.eac3,
    })
    expect(planOnIos({ media, transcoding: TRANSCODINGS.off })).toEqual({
      modes: [],
      problems: [MKV_REFUSED],
    })
  })

  it('plays MOV, the same ISO format, and every audio codec the HLS route copies', () => {
    const plays = (audioCodec: string) =>
      planOnIos({
        media: mediaItemFor({
          container: CONTAINERS.mov,
          videoCodec: VIDEO_CODECS.h264,
          videoBitDepth: 8,
          audioCodec,
        }),
      }).modes[0] ?? null
    expect(HLS_COPY_AUDIO.map((codec) => plays(codec))).toEqual(
      HLS_COPY_AUDIO.map(() => PLAYBACK_MODES.direct),
    )
    expect(plays(UNLISTED.dts)).toBe(PLAYBACK_MODES.remux)
  })
})
