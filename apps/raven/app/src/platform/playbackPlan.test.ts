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
  TRANSCODINGS,
  VIDEO_CODECS,
} from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'
import { SUBTITLE_CODECS } from '@/test/subtitleCodecs'

import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'
import { planFor } from '@/platform/playbackPlan'

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

const modesOn = ({
  platform,
  shouldDrawCaptions,
  media = MP4,
  tracks,
  policy = AUTO,
}: {
  platform: AppPlatform
  shouldDrawCaptions: boolean
  media?: MediaItem
  tracks: MediaTracks | null
  policy?: PlaybackPolicy
}) => planFor({ platform, shouldDrawCaptions, media, tracks, policy }).modes

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
