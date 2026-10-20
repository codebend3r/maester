import { describe, expect, it } from 'bun:test'
import {
  CONTAINERS,
  DIRECT_PLAYS,
  HLS_COPY_AUDIO_CODECS,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackPolicy,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
  TRANSCODINGS,
  VIDEO_CODECS,
} from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'

import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'
import { planFor } from '@/platform/playbackPlan'

/** An H.264 AAC MP4 every Apple device plays as it is. */
const MP4 = mediaItemFor({
  container: CONTAINERS.mp4,
  videoCodec: VIDEO_CODECS.h264,
  videoBitDepth: 8,
  audioCodec: HLS_COPY_AUDIO_CODECS.aac,
})

/** ffprobe's names for the subtitle formats these files carry. */
const SUBTITLE_CODECS = { srt: 'srt', movText: 'mov_text', pgs: 'hdmv_pgs_subtitle' } as const

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

const modesOn = ({
  platform,
  tracks,
  policy = AUTO,
}: {
  platform: AppPlatform
  tracks: MediaTracks | null
  policy?: PlaybackPolicy
}) => planFor({ platform, media: MP4, tracks, policy }).modes

const EVERY_WAY = [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]
const CONVERTED = [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode]

describe('planFor on Apple TV', () => {
  it('starts a direct-playable MP4 with a sidecar at the remux, whose subtitles are renditions', () => {
    expect(modesOn({ platform: APP_PLATFORMS.tvos, tracks: tracksWith([SIDECAR]) })).toEqual(
      CONVERTED,
    )
  })

  it('plays the same MP4 as it is when it has no subtitles', () => {
    expect(modesOn({ platform: APP_PLATFORMS.tvos, tracks: tracksWith([]) })).toEqual(EVERY_WAY)
  })

  it('starts at the remux for an embedded text track too', () => {
    expect(modesOn({ platform: APP_PLATFORMS.tvos, tracks: tracksWith([EMBEDDED_TEXT]) })).toEqual(
      CONVERTED,
    )
  })

  it('plays the file as it is when its only subtitles are pictures, which have no rendition', () => {
    expect(
      modesOn({ platform: APP_PLATFORMS.tvos, tracks: tracksWith([EMBEDDED_PICTURES]) }),
    ).toEqual(EVERY_WAY)
  })

  it('plays the file as it is when its tracks could not be read', () => {
    expect(modesOn({ platform: APP_PLATFORMS.tvos, tracks: null })).toEqual(EVERY_WAY)
  })

  it('keeps direct play when the server converts nothing, so the video still plays', () => {
    expect(
      modesOn({
        platform: APP_PLATFORMS.tvos,
        tracks: tracksWith([SIDECAR]),
        policy: { ...AUTO, transcoding: TRANSCODINGS.off },
      }),
    ).toEqual([PLAYBACK_MODES.direct])
  })

  it('keeps direct play where the server forces it', () => {
    expect(
      modesOn({
        platform: APP_PLATFORMS.tvos,
        tracks: tracksWith([SIDECAR]),
        policy: { ...AUTO, directPlay: DIRECT_PLAYS.force },
      }),
    ).toEqual([PLAYBACK_MODES.direct])
  })
})

describe('planFor where raven draws the subtitles', () => {
  it('plays an MP4 with a sidecar as it is on iPhone and iPad', () => {
    expect(modesOn({ platform: APP_PLATFORMS.ios, tracks: tracksWith([SIDECAR]) })).toEqual(
      EVERY_WAY,
    )
  })
})
