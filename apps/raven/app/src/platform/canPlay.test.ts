import { describe, expect, it } from 'bun:test'
import {
  DIRECT_PLAYS,
  type MediaItem,
  PLAYBACK_MODES,
  type PlaybackSettings,
  TRANSCODINGS,
  planPlayback,
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

const MKV_REFUSED = "The MKV container isn't supported here."

describe('canPlayFor on iPhone and iPad', () => {
  it('starts an H.264 AAC MP4 as the original file', () => {
    const media = mediaItemFor({
      container: 'mp4',
      videoCodec: 'h264',
      videoBitDepth: 8,
      audioCodec: 'aac',
    })
    expect(planOnIos({ media })).toEqual({
      modes: [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
      problems: [],
    })
  })

  it('starts an HEVC TrueHD MKV at the remux, whose HLS copies the video', () => {
    const media = mediaItemFor({
      container: 'mkv',
      videoCodec: 'hevc',
      videoBitDepth: 10,
      audioCodec: 'truehd',
    })
    expect(planOnIos({ media })).toEqual({
      modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
      problems: [MKV_REFUSED],
    })
  })

  it('tries an HEVC MP4 as it is, since only an hev1 tag refuses, with the remux after it', () => {
    const media = mediaItemFor({
      container: 'mp4',
      videoCodec: 'hevc',
      videoBitDepth: 10,
      audioCodec: 'eac3',
    })
    expect(planOnIos({ media }).modes.slice(0, 2)).toEqual([
      PLAYBACK_MODES.direct,
      PLAYBACK_MODES.remux,
    ])
  })

  it('answers for the hvc1 string the remux is re-tagged to', () => {
    const { canStream } = canPlayFor(APP_PLATFORMS.ios)
    const hevc = videoCodecString({ codec: 'hevc', bitDepth: 10 })
    expect(hevc).toStartWith('hvc1.')
    expect(canStream(`video/mp4; codecs="${hevc}"`)).toBe(true)
  })

  it('sends an AV1 MKV through the transcode, since AVPlayer decodes no AV1 here', () => {
    const media = mediaItemFor({
      container: 'mkv',
      videoCodec: 'av1',
      videoBitDepth: 10,
      audioCodec: 'opus',
    })
    expect(planOnIos({ media }).modes).toEqual([PLAYBACK_MODES.transcode])
  })

  it('sends a 10-bit H.264 MKV through the transcode, since AVPlayer has no High 10 decoder', () => {
    const media = mediaItemFor({
      container: 'mkv',
      videoCodec: 'h264',
      videoBitDepth: 10,
      audioCodec: 'aac',
    })
    expect(planOnIos({ media }).modes).toEqual([PLAYBACK_MODES.transcode])
  })

  it('plays H.264 in MP4 as it is only at 8 bits', () => {
    const planAt = (videoBitDepth: number) =>
      planOnIos({
        media: mediaItemFor({
          container: 'mp4',
          videoCodec: 'h264',
          videoBitDepth,
          audioCodec: 'aac',
        }),
      }).modes
    expect(planAt(8)[0] ?? null).toBe(PLAYBACK_MODES.direct)
    expect(planAt(10)).toEqual([PLAYBACK_MODES.transcode])
  })

  it('leaves an MKV no way to play when the server converts nothing', () => {
    const media = mediaItemFor({
      container: 'mkv',
      videoCodec: 'hevc',
      videoBitDepth: 10,
      audioCodec: 'eac3',
    })
    expect(planOnIos({ media, transcoding: TRANSCODINGS.off })).toEqual({
      modes: [],
      problems: [MKV_REFUSED],
    })
  })

  it('plays MOV, the same ISO format, and every audio codec the HLS route copies', () => {
    const plays = (audioCodec: string) =>
      planOnIos({
        media: mediaItemFor({ container: 'mov', videoCodec: 'h264', videoBitDepth: 8, audioCodec }),
      }).modes[0] ?? null
    expect(['aac', 'ac3', 'eac3', 'alac', 'flac'].map((codec) => plays(codec))).toEqual(
      Array.from({ length: 5 }, () => PLAYBACK_MODES.direct),
    )
    expect(plays('dts')).toBe(PLAYBACK_MODES.remux)
  })
})
