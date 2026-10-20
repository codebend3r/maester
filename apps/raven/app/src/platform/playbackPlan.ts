import {
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackPlan,
  type PlaybackPolicy,
  planPlayback,
} from '@raven/core'

import { canPlayFor } from '@/platform/canPlay'
import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

/**
 * Whether the original file shows its text subtitles there. raven draws them itself under the
 * thumb (and on Android TV until it has a player of its own), from the server's WebVTT, in any
 * mode. Apple TV's system transport shows only what its player selects, and its subtitle panel
 * lists only an HLS stream's renditions, so there a file's text tracks need the remux.
 */
const DIRECT_SHOWS_SUBTITLES: Record<AppPlatform, boolean> = {
  [APP_PLATFORMS.ios]: true,
  [APP_PLATFORMS.tvos]: false,
  [APP_PLATFORMS.androidTv]: true,
}

/**
 * The ways to play a video on a platform, as core's `planPlayback` plans them from the
 * platform's table, with the original file planned with its default audio, since direct play
 * switches audio tracks itself. Where the original file cannot show its text subtitles (Apple
 * TV), a file that has any starts at the remux, whose subtitles are renditions. Direct play
 * stays only as the one way left: when the server converts nothing, or forces the original.
 */
export const planFor = ({
  platform,
  media,
  tracks,
  policy,
}: {
  platform: AppPlatform
  media: MediaItem
  tracks: MediaTracks | null
  policy: PlaybackPolicy
}): PlaybackPlan => {
  const plan = planPlayback({ media, ...canPlayFor(platform), defaultAudio: true, policy })
  const hasTextSubtitles = tracks?.subtitles.some((track) => track.supported) ?? false
  if (DIRECT_SHOWS_SUBTITLES[platform] || !hasTextSubtitles) return plan
  const converted = plan.modes.filter((mode) => mode !== PLAYBACK_MODES.direct)
  return converted.length === 0 ? plan : { ...plan, modes: converted }
}
