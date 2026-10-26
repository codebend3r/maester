import { describe, expect, it } from 'bun:test'
import {
  CONTAINERS,
  DIRECT_PLAYS,
  HLS_COPY_AUDIO_CODECS,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackPolicy,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
  AUDIO_CODECS,
  TRANSCODINGS,
  VIDEO_CODECS,
} from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'
import { SUBTITLE_CODECS } from '@/test/subtitleCodecs'

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

const SIDECAR = subtitleTrack({
  id: 'external-0',
  source: SUBTITLE_SOURCES.external,
  codec: SUBTITLE_CODECS.srt,
})
const EMBEDDED_TEXT = subtitleTrack({ id: 'embedded-0' })
const EMBEDDED_PICTURES = subtitleTrack({
  id: 'embedded-1',
  codec: SUBTITLE_CODECS.pgs,
  supported: false,
})

const tracksWith = (subtitles: SubtitleTrack[]): MediaTracks => ({
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
  subtitles,
  defaultAudio: 0,
  frameRate: 24,
})

const AUTO: PlaybackPolicy = { directPlay: DIRECT_PLAYS.auto, transcoding: TRANSCODINGS.on }

/** Apple TV under its TV chrome, where the system's player draws the subtitles. */
const APPLE_TV = { platform: APP_PLATFORMS.tvos, shouldDrawCaptions: false } as const

/** Android TV under its d-pad chrome, which draws the subtitles itself. */
const ANDROID_TV = { platform: APP_PLATFORMS.androidTv, shouldDrawCaptions: true } as const

type PlanOnProps = {
  platform: AppPlatform
  shouldDrawCaptions: boolean
  media?: MediaItem
  tracks: MediaTracks | null
  policy?: PlaybackPolicy
  prefs?: PlaybackPrefs
}

const planOn = ({
  platform,
  shouldDrawCaptions,
  media = MP4,
  tracks,
  policy = AUTO,
  prefs = DEFAULT_APP_PREFS,
}: PlanOnProps) => planFor({ platform, shouldDrawCaptions, media, tracks, policy, prefs })

const modesOn = (input: Parameters<typeof planOn>[0]) => planOn(input).modes

const EVERY_WAY = [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]
const CONVERTED = [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]

describe('planFor where the system draws the subtitles', () => {
  it('starts a direct-playable MP4 with a sidecar at the remux, whose subtitles are renditions', () => {
    expect(modesOn({ ...APPLE_TV, tracks: tracksWith([SIDECAR]) })).toEqual(CONVERTED)
  })

  it('plays the same MP4 as it is when it has no subtitles', () => {
    expect(modesOn({ ...APPLE_TV, tracks: tracksWith([]) })).toEqual(EVERY_WAY)
  })

  it('starts at the remux for an embedded text track too', () => {
    expect(modesOn({ ...APPLE_TV, tracks: tracksWith([EMBEDDED_TEXT]) })).toEqual(CONVERTED)
  })

  it('plays the file as it is when its only subtitles are pictures, which have no rendition', () => {
    expect(modesOn({ ...APPLE_TV, tracks: tracksWith([EMBEDDED_PICTURES]) })).toEqual(EVERY_WAY)
  })

  it('plays the file as it is when its tracks could not be read', () => {
    expect(modesOn({ ...APPLE_TV, tracks: null })).toEqual(EVERY_WAY)
  })

  it('keeps direct play when the server converts nothing, so the video still plays', () => {
    expect(
      modesOn({
        ...APPLE_TV,
        tracks: tracksWith([SIDECAR]),
        policy: { ...AUTO, transcoding: TRANSCODINGS.off },
      }),
    ).toEqual([PLAYBACK_MODES.direct])
  })

  it('keeps direct play where the server forces it', () => {
    expect(
      modesOn({
        ...APPLE_TV,
        tracks: tracksWith([SIDECAR]),
        policy: { ...AUTO, directPlay: DIRECT_PLAYS.force },
      }),
    ).toEqual([PLAYBACK_MODES.direct])
  })

  it("takes the chrome's word, not the platform's: Android TV would start at the remux too", () => {
    expect(
      modesOn({
        ...ANDROID_TV,
        shouldDrawCaptions: false,
        media: MKV,
        tracks: tracksWith([SIDECAR]),
      }),
    ).toEqual(CONVERTED)
  })
})

describe('planFor where raven draws the subtitles', () => {
  it('plays an MP4 with a sidecar as it is on iPhone and iPad', () => {
    expect(
      modesOn({
        platform: APP_PLATFORMS.ios,
        shouldDrawCaptions: true,
        tracks: tracksWith([SIDECAR]),
      }),
    ).toEqual(EVERY_WAY)
  })

  it('keeps a direct-playable MKV with a sidecar as it is on Android TV', () => {
    expect(modesOn({ ...ANDROID_TV, media: MKV, tracks: tracksWith([SIDECAR]) })).toEqual(EVERY_WAY)
  })

  it("keeps an embedded text track's file as it is on Android TV too", () => {
    expect(modesOn({ ...ANDROID_TV, media: MKV, tracks: tracksWith([EMBEDDED_TEXT]) })).toEqual(
      EVERY_WAY,
    )
  })
})

/** An iPhone, where raven draws the subtitles. */
const IPHONE = { platform: APP_PLATFORMS.ios, shouldDrawCaptions: true, tracks: null } as const

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
    expect(modesOn({ ...ANDROID_TV, media: MKV, tracks: null, prefs: NO_TRANSCODE })).toEqual([
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
    expect(modesOn({ ...ANDROID_TV, media: trueHd, tracks: null, prefs: NO_MAYBES })).toEqual(
      CONVERTED,
    )
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
