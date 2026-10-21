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
 * settled (`hasAskedPick`, `AUDIO_SETTLE_SECONDS`), each saying whether it was picked. Apple's
 * players are never asked: their table names only audio they decode. Nor is a stream, which
 * carries only the track the session asked the server for.
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
  reported: ReportedAudio
}): boolean => {
  if (platform !== APP_PLATFORMS.androidTv || mode !== PLAYBACK_MODES.direct) return false
  if (reported.length === 0) return false
  if (place === null) return !reported.some((track) => track.selected === true)
  const asked = reported.at(place)
  return asked === undefined || asked.selected !== true
}

/** The player's audio tracks as it reports them, each saying whether it was picked. */
type ReportedAudio = readonly { index: number; selected?: boolean }[]

/**
 * Whether the player's pick is already the one asked for: the track at `place`, or any where
 * the player was left to choose. `react-native-video` 6.19.3 hands ExoPlayer the asked track
 * only as it reports the load, so a load whose pick is another one has not settled yet.
 */
export const hasAskedPick = ({
  place,
  reported,
}: {
  place: number | null
  reported: ReportedAudio
}): boolean => {
  if (place === null) return true
  const asked = reported.at(place)
  return asked !== undefined && asked.selected === true
}

/**
 * How long, in seconds of play after the load, an unsettled pick has to settle. ExoPlayer
 * starts its progress before it reports the load, and applies the asked track only after, so
 * the first ticks come with its own first pick and `onAudioTracks` with the asked one a round
 * trip later; a pick still unsettled after this is judged as it stands.
 */
export const AUDIO_SETTLE_SECONDS = 2
