import { PLAYBACK_MODES, type PlaybackMode } from '@raven/core'

import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

/**
 * Whether the original file is playing without the audio track asked for. ExoPlayer selects no
 * track it can neither decode nor pass through, and reports no error: it plays the picture
 * alone, or another of the file's tracks (a commentary in the wrong language). That is how a
 * maybe in Android TV's table (DTS, TrueHD) refuses, and the player then steps down to the
 * remux, whose audio the server makes E-AC-3. `place` is the asked track's place among the
 * player's, which keep the file's order, or null where the player was left to choose, when any
 * track will do; `reported` is the player's last word on its tracks once the asked one has
 * settled (`onAudioTracks`, not `onLoad`, which comes first), each saying whether it was picked. Apple's players are never asked: their table names only audio
 * they decode. Nor is a stream, which carries only the track the session asked the server for.
 */
export const isAudioDropped = ({
  platform,
  mode,
  place,
  reported,
}: {
  platform: AppPlatform
  mode: PlaybackMode | null
  place: number | null
  reported: readonly { index: number; selected?: boolean }[]
}): boolean => {
  if (platform !== APP_PLATFORMS.androidTv || mode !== PLAYBACK_MODES.direct) return false
  if (reported.length === 0) return false
  if (place === null) return !reported.some((track) => track.selected === true)
  const asked = reported.at(place)
  return asked === undefined || asked.selected !== true
}
