import { describe, expect, it } from 'bun:test'
import {
  AUDIO_CODECS,
  CONTAINERS,
  DIRECT_PLAYS,
  HLS_COPY_AUDIO,
  HLS_COPY_AUDIO_CODECS,
  type MediaItem,
  PLAYBACK_MODES,
  type PlaybackSettings,
  TRANSCODINGS,
  VIDEO_CODECS,
  audioCodecString,
  planPlayback,
  streamMimeType,
  videoCodecString,
} from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'

import { canPlayFor } from '@/platform/canPlay'
import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

type PlanOnProps = {
  platform: AppPlatform
  media: MediaItem
  transcoding?: PlaybackSettings['transcoding']
}

const planOn = ({ platform, media, transcoding = TRANSCODINGS.on }: PlanOnProps) =>
  planPlayback({
    media,
    ...canPlayFor(platform),
    defaultAudio: true,
    policy: { directPlay: DIRECT_PLAYS.auto, transcoding },
  })

type PlanOnIosProps = {
  media: MediaItem
  transcoding?: PlaybackSettings['transcoding']
}

const planOnIos = ({ media, transcoding }: PlanOnIosProps) =>
  planOn({ platform: APP_PLATFORMS.ios, media, transcoding })

/** ffprobe's name for a container no table lists, which only this file carries. */
const UNLISTED = { avi: 'avi' } as const

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
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: AUDIO_CODECS.truehd,
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
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: AUDIO_CODECS.truehd,
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
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.av1,
      videoBitDepth: 10,
      audioCodec: AUDIO_CODECS.opus,
    })
    expect(planOnIos({ media }).modes).toEqual([PLAYBACK_MODES.transcode])
  })

  it('sends a 10-bit H.264 MKV through the transcode, since AVPlayer has no High 10 decoder', () => {
    const media = mediaItemFor({
      container: CONTAINERS.mkv,
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
      container: CONTAINERS.mkv,
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
    expect(plays(AUDIO_CODECS.dts)).toBe(PLAYBACK_MODES.remux)
  })
})

describe('canPlayFor on Android TV', () => {
  const planOnTv = (media: MediaItem) => planOn({ platform: APP_PLATFORMS.androidTv, media })
  const EVERY_WAY = [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]

  it('starts an HEVC E-AC-3 MKV as the original file, which ExoPlayer reads', () => {
    const media = mediaItemFor({
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: HLS_COPY_AUDIO_CODECS.eac3,
    })
    expect(planOnTv(media)).toEqual({ modes: EVERY_WAY, problems: [] })
  })

  it('tries TrueHD and DTS as they are, a maybe the device answers, with the remux after them', () => {
    const plays = (audioCodec: string) =>
      planOnTv(
        mediaItemFor({
          container: CONTAINERS.mkv,
          videoCodec: VIDEO_CODECS.h264,
          videoBitDepth: 8,
          audioCodec,
        }),
      ).modes
    expect(plays(AUDIO_CODECS.truehd)).toEqual(EVERY_WAY)
    expect(plays(AUDIO_CODECS.dts)).toEqual(EVERY_WAY)
  })

  it('plays VP9 in WebM as it is', () => {
    const media = mediaItemFor({
      container: CONTAINERS.webm,
      videoCodec: VIDEO_CODECS.vp9,
      videoBitDepth: 8,
      audioCodec: AUDIO_CODECS.opus,
    })
    expect(planOnTv(media).modes).toEqual(EVERY_WAY)
  })

  it('plays AV1 as it is, at either depth', () => {
    const planAt = (videoBitDepth: number) =>
      planOnTv(
        mediaItemFor({
          container: CONTAINERS.mkv,
          videoCodec: VIDEO_CODECS.av1,
          videoBitDepth,
          audioCodec: AUDIO_CODECS.opus,
        }),
      ).modes
    expect(planAt(8)).toEqual(EVERY_WAY)
    expect(planAt(10)).toEqual(EVERY_WAY)
  })

  it('plays every audio codec in its table as it is, in MP4 and MOV too', () => {
    const playable = [
      AUDIO_CODECS.aac,
      AUDIO_CODECS.ac3,
      AUDIO_CODECS.eac3,
      AUDIO_CODECS.opus,
      AUDIO_CODECS.vorbis,
      AUDIO_CODECS.flac,
      AUDIO_CODECS.mp3,
    ]
    type FirstWayProps = { container: string; audioCodec: string }

    const firstWay = ({ container, audioCodec }: FirstWayProps) =>
      planOnTv(
        mediaItemFor({ container, videoCodec: VIDEO_CODECS.h264, videoBitDepth: 8, audioCodec }),
      ).modes[0] ?? null
    expect(
      [CONTAINERS.mp4, CONTAINERS.mov].flatMap((container) =>
        playable.map((audioCodec) => firstWay({ container, audioCodec })),
      ),
    ).toEqual(Array.from({ length: playable.length * 2 }, () => PLAYBACK_MODES.direct))
  })

  it('sends a 10-bit H.264 MKV through the transcode, as on Apple: few TVs decode High 10', () => {
    const media = mediaItemFor({
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.h264,
      videoBitDepth: 10,
      audioCodec: HLS_COPY_AUDIO_CODECS.aac,
    })
    expect(planOnTv(media).modes).toEqual([PLAYBACK_MODES.transcode])
  })

  it('starts a container ExoPlayer is not given at the remux', () => {
    const media = mediaItemFor({
      container: UNLISTED.avi,
      videoCodec: VIDEO_CODECS.h264,
      videoBitDepth: 8,
      audioCodec: AUDIO_CODECS.mp3,
    })
    expect(planOnTv(media)).toEqual({
      modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
      problems: ["The AVI container isn't supported here."],
    })
  })

  it('plays every stream the server converts to, whatever video it copies', () => {
    const { canStream } = canPlayFor(APP_PLATFORMS.androidTv)
    const streams = [
      { codec: VIDEO_CODECS.hevc, bitDepth: 10, audio: AUDIO_CODECS.truehd },
      { codec: VIDEO_CODECS.av1, bitDepth: 10, audio: AUDIO_CODECS.opus },
      { codec: VIDEO_CODECS.vp9, bitDepth: 8, audio: AUDIO_CODECS.vorbis },
      { codec: VIDEO_CODECS.h264, bitDepth: 8, audio: AUDIO_CODECS.dts },
    ].flatMap(({ codec, bitDepth, audio }) => {
      const media = mediaItemFor({
        container: CONTAINERS.mkv,
        videoCodec: codec,
        videoBitDepth: bitDepth,
        audioCodec: audio,
      })
      return [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode].map((mode) =>
        canStream(streamMimeType({ media, mode })),
      )
    })
    expect(streams).toEqual(streams.map(() => true))
  })

  it('decodes the audio an HLS stream carries, all but ALAC, which the route copies as it is', () => {
    const { canStream } = canPlayFor(APP_PLATFORMS.androidTv)
    const carried = [...HLS_COPY_AUDIO, HLS_COPY_AUDIO_CODECS.eac3]
    expect(
      carried.filter((codec) => !canStream(`video/mp4; codecs="${audioCodecString(codec)}"`)),
    ).toEqual([HLS_COPY_AUDIO_CODECS.alac])
  })
})

describe('canPlaySurely, for a viewer who would rather not try a maybe', () => {
  type SureOnProps = { platform: AppPlatform; media: MediaItem }

  const sureOn = ({ platform, media }: SureOnProps) =>
    planPlayback({
      media,
      canPlay: canPlayFor(platform).canPlaySurely,
      canStream: canPlayFor(platform).canStream,
      defaultAudio: true,
      policy: { directPlay: DIRECT_PLAYS.auto, transcoding: TRANSCODINGS.on },
    }).modes

  it('leaves HEVC in MP4 or MOV, the same ISO format, to the remux on Apple, and keeps H.264', () => {
    const hevcIn = (container: string) =>
      mediaItemFor({
        container,
        videoCodec: VIDEO_CODECS.hevc,
        videoBitDepth: 10,
        audioCodec: HLS_COPY_AUDIO_CODECS.aac,
      })
    const converted = [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]
    expect(sureOn({ platform: APP_PLATFORMS.tvos, media: hevcIn(CONTAINERS.mp4) })).toEqual(
      converted,
    )
    expect(sureOn({ platform: APP_PLATFORMS.ios, media: hevcIn(CONTAINERS.mov) })).toEqual(
      converted,
    )
    const h264 = mediaItemFor({
      container: CONTAINERS.mp4,
      videoCodec: VIDEO_CODECS.h264,
      videoBitDepth: 8,
      audioCodec: HLS_COPY_AUDIO_CODECS.aac,
    })
    expect(sureOn({ platform: APP_PLATFORMS.ios, media: h264 })[0]).toBe(PLAYBACK_MODES.direct)
  })

  it('leaves TrueHD and DTS to the remux on Android TV, and keeps what ExoPlayer surely plays', () => {
    const mkvWith = (audioCodec: string) =>
      mediaItemFor({
        container: CONTAINERS.mkv,
        videoCodec: VIDEO_CODECS.hevc,
        videoBitDepth: 10,
        audioCodec,
      })
    const converted = [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]
    expect(
      sureOn({ platform: APP_PLATFORMS.androidTv, media: mkvWith(AUDIO_CODECS.truehd) }),
    ).toEqual(converted)
    expect(sureOn({ platform: APP_PLATFORMS.androidTv, media: mkvWith(AUDIO_CODECS.dts) })).toEqual(
      converted,
    )
    expect(
      sureOn({ platform: APP_PLATFORMS.androidTv, media: mkvWith(HLS_COPY_AUDIO_CODECS.eac3) })[0],
    ).toBe(PLAYBACK_MODES.direct)
  })

  it('answers every stream as canStream does, since a remux re-tags HEVC and carries AAC', () => {
    const { canPlaySurely, canStream } = canPlayFor(APP_PLATFORMS.ios)
    const media = mediaItemFor({
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: AUDIO_CODECS.truehd,
    })
    const stream = streamMimeType({ media, mode: PLAYBACK_MODES.remux })
    expect(canStream(stream)).toBe(true)
    expect(canPlaySurely(stream)).toBe(false)
  })
})
