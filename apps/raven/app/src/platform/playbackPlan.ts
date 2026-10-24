import {
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackPlan,
  type PlaybackPolicy,
  planPlayback,
} from '@raven/core'

import { canPlayFor } from '@/platform/canPlay'
import type { AppPlatform } from '@/platform/platform'

/**
 * The ways to play a video on a platform, as core's `planPlayback` plans them from the
 * platform's table, with the original file planned with its default audio, since direct play
 * switches audio tracks itself. `shouldDrawCaptions` is the player chrome's: where raven draws
 * the cues (under the thumb and on Android TV) it reads them from the server's WebVTT in any
 * mode, and where it does not (Apple TV's system transport), the platform's player shows only
 * an HLS stream's renditions, so a file with text subtitles starts at the remux. Direct play
 * stays only as the one way left: when the server converts nothing, or forces the original.
 */
export const planFor = ({
  platform,
  media,
  tracks,
  policy,
  shouldDrawCaptions,
}: {
  platform: AppPlatform
  media: MediaItem
  tracks: MediaTracks | null
  policy: PlaybackPolicy
  shouldDrawCaptions: boolean
}): PlaybackPlan => {
  const plan = planPlayback({ media, ...canPlayFor(platform), defaultAudio: true, policy })
  const hasTextSubtitles = tracks?.subtitles.some((track) => track.supported) ?? false
  if (shouldDrawCaptions || !hasTextSubtitles) return plan
  const converted = plan.modes.filter((mode) => mode !== PLAYBACK_MODES.direct)
  return converted.length === 0 ? plan : { ...plan, modes: converted }
}
