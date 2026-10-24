import { PLAYBACK_MODES, type PlaybackMode } from '@raven/core'

import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

/** The player's audio tracks as it reports them, each saying whether it was picked. */
type ReportedAudio = readonly { index: number; selected?: boolean }[]

/**
 * Whether the track asked for is the one the player picked: the track at `place`, its place
 * among the player's (which keep the file's order), or any where the player was left to
 * choose (`place` null).
 */
const isAskedPicked = ({ place, reported }: { place: number | null; reported: ReportedAudio }) =>
  place === null
    ? reported.some((track) => track.selected === true)
    : (reported.at(place)?.selected ?? false)

/**
 * Whether the original file is playing without the audio track asked for. ExoPlayer selects no
 * track it can neither decode nor pass through, and reports no error: it plays the picture
 * alone, or another of the file's tracks (a commentary in the wrong language). That is how a
 * maybe in Android TV's table (DTS, TrueHD) refuses, and the player then steps down to the
 * remux, whose audio the server makes E-AC-3. Apple's players are never asked: their table
 * names only audio they decode. Nor is a stream, which carries only the track the session asked
 * the server for.
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
}): boolean =>
  platform === APP_PLATFORMS.androidTv &&
  mode === PLAYBACK_MODES.direct &&
  reported.length > 0 &&
  !isAskedPicked({ place, reported })

/**
 * How long, in seconds of play after the load, an unsettled pick has to settle. ExoPlayer
 * starts its progress before it reports the load, and applies the asked track only after, so
 * the first ticks come with its own first pick and `onAudioTracks` with the asked one a round
 * trip later; a pick still unsettled after this is judged as it stands.
 */
export const AUDIO_SETTLE_SECONDS = 2

/** What the player says of one attempt that the audio's judgement listens to. */
export const AUDIO_HEARINGS = {
  loaded: 'loaded',
  tracks: 'tracks',
  moved: 'moved',
  sought: 'sought',
} as const

export type AudioHearing =
  | {
      type: typeof AUDIO_HEARINGS.loaded
      attempt: number
      reported: ReportedAudio
      place: number | null
    }
  | { type: typeof AUDIO_HEARINGS.tracks; attempt: number; reported: ReportedAudio }
  | { type: typeof AUDIO_HEARINGS.moved; attempt: number; clock: number }
  | { type: typeof AUDIO_HEARINGS.sought; attempt: number; clock: number }

/** What has been heard of one attempt's audio, until it is judged. */
export type HeardAudio = {
  attempt: number
  /** The player's last word on its tracks. */
  reported: ReportedAudio
  hasLoaded: boolean
  /** Whether the pick is the asked one's by now: at the load, or told since by `onAudioTracks`. */
  isSettled: boolean
  /** Seconds played since the load, counted between ticks, so a seek's jump never counts. */
  played: number
  /** The clock at the last tick or seek since the load; null before the first. */
  clock: number | null
  isJudged: boolean
}

const freshFor = (attempt: number): HeardAudio => ({
  attempt,
  reported: [],
  hasLoaded: false,
  isSettled: false,
  played: 0,
  clock: null,
  isJudged: false,
})

/**
 * Hears what the player says of an attempt's audio, and says when to judge it: once per
 * attempt, at a tick after the load, with the player's last word (`toJudge`). `react-native-video`
 * 6.19.3 hands ExoPlayer the asked track only as it reports the load, so `onLoad` still names
 * ExoPlayer's own first pick and `onAudioTracks` the settled one. A load whose pick is already
 * the asked one is judged at the next tick; another waits for `onAudioTracks`, or for
 * `AUDIO_SETTLE_SECONDS` of play.
 */
export const hearAudio = ({
  heard,
  hearing,
}: {
  heard: HeardAudio | null
  hearing: AudioHearing
}): { heard: HeardAudio | null; toJudge: ReportedAudio | null } => {
  const last = heard !== null && heard.attempt === hearing.attempt ? heard : null
  switch (hearing.type) {
    case AUDIO_HEARINGS.loaded: {
      const { reported, place } = hearing
      const isSettled = place === null || isAskedPicked({ place, reported })
      const loaded = { reported, hasLoaded: true, isSettled, played: 0, clock: null }
      return { heard: { ...(last ?? freshFor(hearing.attempt)), ...loaded }, toJudge: null }
    }
    case AUDIO_HEARINGS.tracks: {
      const tracks = { reported: hearing.reported, isSettled: last?.hasLoaded ?? false }
      return { heard: { ...(last ?? freshFor(hearing.attempt)), ...tracks }, toJudge: null }
    }
    case AUDIO_HEARINGS.sought:
      return { heard: last === null ? heard : { ...last, clock: hearing.clock }, toJudge: null }
    case AUDIO_HEARINGS.moved: {
      if (last === null || !last.hasLoaded || last.isJudged) return { heard, toJudge: null }
      const since = last.clock ?? hearing.clock
      const played = last.played + Math.max(0, hearing.clock - since)
      const isJudged = last.isSettled || played >= AUDIO_SETTLE_SECONDS
      return {
        heard: { ...last, played, clock: hearing.clock, isJudged },
        toJudge: isJudged ? last.reported : null,
      }
    }
    default: {
      const unknown: never = hearing
      return unknown
    }
  }
}
