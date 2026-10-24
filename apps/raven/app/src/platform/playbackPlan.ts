import {
  type CanPlay,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackPlan,
  type PlaybackPolicy,
  TRANSCODINGS,
  planPlayback,
} from '@raven/core'

import { canPlayFor } from '@/platform/canPlay'
import type { AppPlatform } from '@/platform/platform'
import type { AppPrefsValues } from '@/stores/appPrefs'

/** The viewer's playback choices on this device, which narrow the server's policy. */
export type PlaybackPrefs = Pick<AppPrefsValues, 'shouldPreferDirectPlay' | 'isTranscodeAllowed'>

/** Why a file has no way to play once this device's Settings took the transcode away. */
export const TRANSCODING_OFF_HERE = "Transcoding is off in this device's Settings."

/**
 * The ways to play a video on a platform, as core's `planPlayback` plans them from the
 * platform's table under the server's policy narrowed by `prefs`, never widened: with
 * transcoding not allowed here, a server that would transcode only remuxes. The original file
 * is planned with its default audio, since direct play switches audio tracks itself. A maybe in
 * the table is tried as it is only while the viewer prefers direct play, or when nothing else
 * is left.
 * `shouldDrawCaptions` is the player chrome's: where raven draws the cues (under the thumb and
 * on Android TV) it reads them from the server's WebVTT in any mode, and where it does not
 * (Apple TV's system transport), the platform's player shows only an HLS stream's renditions,
 * so a file with text subtitles starts at the remux. Direct play stays only as the one way
 * left: when the server converts nothing, or forces the original.
 */
export const planFor = ({
  platform,
  media,
  tracks,
  policy,
  prefs,
  shouldDrawCaptions,
}: {
  platform: AppPlatform
  media: MediaItem
  tracks: MediaTracks | null
  policy: PlaybackPolicy
  prefs: PlaybackPrefs
  shouldDrawCaptions: boolean
}): PlaybackPlan => {
  const { canPlay, canPlaySurely, canStream } = canPlayFor(platform)
  const isTranscodeTaken = !prefs.isTranscodeAllowed && policy.transcoding === TRANSCODINGS.on
  const policyHere = isTranscodeTaken ? { ...policy, transcoding: TRANSCODINGS.remuxOnly } : policy
  const planWith = (answer: CanPlay): PlaybackPlan =>
    planPlayback({ media, canPlay: answer, canStream, defaultAudio: true, policy: policyHere })
  const generous = planWith(canPlay)
  const sure = prefs.shouldPreferDirectPlay ? generous : planWith(canPlaySurely)
  const chosen = sure.modes.length > 0 ? sure : generous
  const plan =
    isTranscodeTaken && chosen.modes.length === 0
      ? { ...chosen, problems: [...chosen.problems, TRANSCODING_OFF_HERE] }
      : chosen
  const hasTextSubtitles = tracks?.subtitles.some((track) => track.supported) ?? false
  if (shouldDrawCaptions || !hasTextSubtitles) return plan
  const converted = plan.modes.filter((mode) => mode !== PLAYBACK_MODES.direct)
  return converted.length === 0 ? plan : { ...plan, modes: converted }
}
