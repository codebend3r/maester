import { describe, expect, it } from 'bun:test'
import {
  CONTAINERS,
  DIRECT_PLAYS,
  HLS_COPY_AUDIO_CODECS,
  type MediaItem,
  PLAYBACK_MODES,
  type PlaybackPolicy,
  AUDIO_CODECS,
  MEDIA_ORIGIN_KINDS,
  STREAM_QUALITIES,
  type StreamQuality,
  TRANSCODINGS,
  isStreamQuality,
  VIDEO_CODECS,
  AT_HOME,
  type PlayNetwork,
} from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'

import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'
import { type PlaybackPrefs, TRANSCODING_OFF_HERE, planFor } from '@/platform/playbackPlan'
import { DEFAULT_APP_PREFS } from '@/stores/appPrefs'

/** An H.264 AAC MP4 every Apple device plays as it is. */
const MP4 = mediaItemFor({
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.h264,
  videoBitDepth: 8,
  audioCodec: HLS_COPY_AUDIO_CODECS.aac,
})

/** An HEVC E-AC-3 MKV, which only Android TV plays as it is. */
const MKV = mediaItemFor({
  container: CONTAINERS.mkv,
  videoCodec: VIDEO_CODECS.hevc,
  videoBitDepth: 10,
  audioCodec: HLS_COPY_AUDIO_CODECS.eac3,
})

const AUTO: PlaybackPolicy = { directPlay: DIRECT_PLAYS.auto, transcoding: TRANSCODINGS.on }

const ANDROID_TV = { platform: APP_PLATFORMS.androidTv } as const

type PlanOnProps = {
  platform: AppPlatform
  media?: MediaItem
  policy?: PlaybackPolicy
  prefs?: PlaybackPrefs
  network?: PlayNetwork
}

const planOn = ({
  platform,
  media = MP4,
  policy = AUTO,
  prefs = DEFAULT_APP_PREFS,
  network = AT_HOME,
}: PlanOnProps) => planFor({ platform, media, policy, prefs, network })

const modesOn = (input: Parameters<typeof planOn>[0]) => planOn(input).modes

const EVERY_WAY = [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]
const CONVERTED = [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]

const IPHONE = { platform: APP_PLATFORMS.ios } as const

/** HEVC in MP4, which AVPlayer refuses under the `hev1` tag: a maybe. */
const HEVC_MP4 = mediaItemFor({
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.hevc,
  videoBitDepth: 10,
  audioCodec: HLS_COPY_AUDIO_CODECS.aac,
})

/** 10-bit H.264, which only a transcode plays on Apple. */
const HIGH_10 = mediaItemFor({
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.h264,
  videoBitDepth: 10,
  audioCodec: HLS_COPY_AUDIO_CODECS.aac,
})

const NO_TRANSCODE: PlaybackPrefs = { ...DEFAULT_APP_PREFS, isTranscodeAllowed: false }
const NO_MAYBES: PlaybackPrefs = { ...DEFAULT_APP_PREFS, shouldPreferDirectPlay: false }

describe("planFor narrowed by this device's settings", () => {
  it('takes the transcode out of the plan when this device allows none', () => {
    expect(modesOn({ ...IPHONE, prefs: NO_TRANSCODE })).toEqual([
      PLAYBACK_MODES.direct,
      PLAYBACK_MODES.remux,
    ])
    expect(modesOn({ ...ANDROID_TV, media: MKV, prefs: NO_TRANSCODE })).toEqual([
      PLAYBACK_MODES.direct,
      PLAYBACK_MODES.remux,
    ])
  })

  it('says so when the transcode was the only way left', () => {
    expect(planOn({ ...IPHONE, media: HIGH_10, prefs: NO_TRANSCODE })).toEqual({
      modes: [],
      problems: ["10-bit H.264 video isn't supported here.", TRANSCODING_OFF_HERE],
    })
  })

  it("never widens the server's policy: what it turns off stays off", () => {
    expect(
      modesOn({ ...IPHONE, policy: { ...AUTO, transcoding: TRANSCODINGS.remuxOnly } }),
    ).toEqual([PLAYBACK_MODES.direct, PLAYBACK_MODES.remux])
    expect(
      planOn({
        ...IPHONE,
        media: HIGH_10,
        policy: { ...AUTO, transcoding: TRANSCODINGS.remuxOnly },
      }).problems,
    ).not.toContain(TRANSCODING_OFF_HERE)
  })

  it('tries a maybe as it is first only while this device prefers direct play', () => {
    expect(modesOn({ ...IPHONE, media: HEVC_MP4 })).toEqual(EVERY_WAY)
    expect(modesOn({ ...IPHONE, media: HEVC_MP4, prefs: NO_MAYBES })).toEqual(CONVERTED)
    const trueHd = mediaItemFor({
      container: CONTAINERS.mkv,
      videoCodec: VIDEO_CODECS.hevc,
      videoBitDepth: 10,
      audioCodec: AUDIO_CODECS.truehd,
    })
    expect(modesOn({ ...ANDROID_TV, media: trueHd, prefs: NO_MAYBES })).toEqual(CONVERTED)
  })

  it('plays what it surely can as it is whether or not direct play is preferred', () => {
    expect(modesOn({ ...IPHONE, prefs: NO_MAYBES })).toEqual(EVERY_WAY)
  })

  it('still tries a maybe as it is when nothing else is left', () => {
    expect(
      modesOn({
        ...IPHONE,
        media: HEVC_MP4,
        policy: { ...AUTO, transcoding: TRANSCODINGS.off },
        prefs: NO_MAYBES,
      }),
    ).toEqual([PLAYBACK_MODES.direct])
  })
})

/** The remote limit the server holds a play away from home to: 720p at 3 Mb/s. */
const LIMIT: StreamQuality = isStreamQuality.values.find(
  (quality) =>
    STREAM_QUALITIES[quality].height === 720 && STREAM_QUALITIES[quality].bitrate === 3_000_000,
)!

const LIMITED = { limit: LIMIT, isOutside: false }
const PUBLIC_PLAY: PlayNetwork = { origin: { kind: MEDIA_ORIGIN_KINDS.public }, remote: LIMITED }
const LAN_PLAY: PlayNetwork = { origin: { kind: MEDIA_ORIGIN_KINDS.lan }, remote: LIMITED }

/** The MP4 at 20 Mb/s, over the limit. */
const HEAVY_MP4 = { ...MP4, bitrate: 20_000_000 }
/** The MP4 at 2 Mb/s, under it. */
const LIGHT_MP4 = { ...MP4, bitrate: 2_000_000 }

const TRANSCODE_FIRST = [PLAYBACK_MODES.transcode, PLAYBACK_MODES.direct, PLAYBACK_MODES.remux]

describe('planFor away from home', () => {
  it('starts a file over the remote limit at the transcode from the public origin', () => {
    expect(modesOn({ ...IPHONE, media: HEAVY_MP4, network: PUBLIC_PLAY })).toEqual(TRANSCODE_FIRST)
  })

  it('plans as at home from a LAN origin, however heavy the file', () => {
    expect(modesOn({ ...IPHONE, media: HEAVY_MP4, network: LAN_PLAY })).toEqual(EVERY_WAY)
  })

  it('plans as at home for a file under the remote limit', () => {
    expect(modesOn({ ...IPHONE, media: LIGHT_MP4, network: PUBLIC_PLAY })).toEqual(EVERY_WAY)
  })

  it("starts at the transcode from the server's own address only when the device is outside", () => {
    const outside = { origin: null, remote: { ...LIMITED, isOutside: true } }
    expect(modesOn({ ...IPHONE, media: HEAVY_MP4, network: outside })).toEqual(TRANSCODE_FIRST)
    const inside = { origin: null, remote: LIMITED }
    expect(modesOn({ ...IPHONE, media: HEAVY_MP4, network: inside })).toEqual(EVERY_WAY)
  })

  it('keeps a plan with no transcode as it is, as this device allowing none leaves it', () => {
    expect(
      modesOn({
        ...IPHONE,
        media: HEAVY_MP4,
        network: PUBLIC_PLAY,
        prefs: NO_TRANSCODE,
      }),
    ).toEqual([PLAYBACK_MODES.direct, PLAYBACK_MODES.remux])
  })
})
