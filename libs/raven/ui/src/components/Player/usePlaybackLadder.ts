import {
  type ApiClient,
  type MediaItem,
  type PlaybackMode,
  type StreamQuality,
  DEFAULT_PLAYBACK_SETTINGS,
  PLAYBACK_MODES,
  offeredQualities,
  planPlayback,
} from '@raven/core'
import { useMemo, useState } from 'react'
import { browserCanPlay, browserCanStream } from '@/lib/canPlay'
import { useQuery } from '@tanstack/react-query'
import { playerQueriesFor } from '@/lib/playerQueries'
import type { Delivery } from '@/lib/streamSource'

/** The ways to play, best first, for one audio track; a step down belongs to one ladder. */
type Ladder = { modes: readonly PlaybackMode[]; audio: number | null }

const sameLadder = ({ a, b }: { a: Ladder; b: Ladder }): boolean =>
  a.audio === b.audio &&
  a.modes.length === b.modes.length &&
  a.modes.every((mode, index) => mode === b.modes[index])

/** A way of playing the connection could not carry, and what it did carry. */
export type StepDown = { from: PlaybackMode; delivery: Delivery }

/** The ways this file can play right now, and the viewer's pick among them. */
export type ModeChoice = {
  modes: readonly PlaybackMode[]
  pick: (mode: PlaybackMode) => void
  /** The sizes a transcode can be asked for, largest first; empty when the server converts nothing. */
  qualities: readonly StreamQuality[]
  /** The size playing, or null for the original or the server's own settings. */
  quality: StreamQuality | null
  /** Converts down to a size: a transcode, asked for at it. */
  pickQuality: (quality: StreamQuality) => void
}

export const PLAYBACK_STATUSES = {
  waiting: 'waiting',
  unplayable: 'unplayable',
  playing: 'playing',
} as const

export type PlaybackStatus =
  /** What picks the first source, the server's playback settings, is on its way. */
  | { status: typeof PLAYBACK_STATUSES.waiting }
  | {
      status: typeof PLAYBACK_STATUSES.unplayable
      problems: string[]
      tryAnyway: (() => void) | null
    }
  /**
   * `fail` steps down to the next way, or gives up once none is left. `slow`
   * steps down to a transcode, the one way lighter on the connection; it is
   * null when there is none below.
   */
  | {
      status: typeof PLAYBACK_STATUSES.playing
      mode: PlaybackMode
      fail: (message: string) => void
      slow: ((delivery: Delivery) => void) | null
      /** Why this is a transcode, when the connection is the reason. */
      steppedDown: StepDown | null
      choice: ModeChoice
      /** The size this transcode is asked for; null when it is not one, or the settings size it. */
      quality: StreamQuality | null
    }

/**
 * How to play a file. The original goes straight to the browser when it can
 * take it; otherwise, or for any audio track but the default, the server
 * converts it. When a way fails mid-play, the next one down is tried, and
 * only when every way has failed is the file unplayable. A new audio track
 * starts again at the top, unless the connection already proved too slow
 * for anything but a transcode: that holds for the rest of the playback.
 * The viewer can pick any way the plan offers; it starts there, and a
 * failure steps down from it.
 */
export const usePlaybackLadder = ({
  media,
  api,
  audio,
  isDefaultAudio,
}: {
  media: MediaItem
  api: ApiClient
  audio: number | null
  isDefaultAudio: boolean
}): PlaybackStatus => {
  const settings = useQuery(playerQueriesFor(api).playbackSettings)
  const policy = settings.data?.settings ?? (settings.isError ? DEFAULT_PLAYBACK_SETTINGS : null)
  const plan = useMemo(
    () =>
      policy &&
      planPlayback({
        media,
        canPlay: browserCanPlay,
        canStream: browserCanStream,
        defaultAudio: isDefaultAudio,
        policy,
      }),
    [media, isDefaultAudio, policy],
  )
  const [forced, setForced] = useState(false)
  const [fallback, setFallback] = useState<{ ladder: Ladder; step: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [steppedDown, setSteppedDown] = useState<StepDown | null>(null)
  const [picked, setPicked] = useState<PlaybackMode | null>(null)
  const [quality, setQuality] = useState<StreamQuality | null>(null)

  // The server's settings say whether to force the original file and what it
  // converts; a plan made without them starts a stream it may refuse.
  if (!plan) return { status: PLAYBACK_STATUSES.waiting }

  const ladder: Ladder = {
    modes: plan.modes.length === 0 && forced ? [PLAYBACK_MODES.direct] : plan.modes,
    audio,
  }
  const failedStep =
    fallback != null && sameLadder({ a: fallback.ladder, b: ladder }) ? fallback.step : 0
  const lighter = ladder.modes.indexOf(PLAYBACK_MODES.transcode)
  const pickedStep = picked == null ? -1 : ladder.modes.indexOf(picked)
  const stepped = steppedDown != null && lighter >= 0 ? Math.max(failedStep, lighter) : failedStep
  const step = Math.max(stepped, pickedStep)
  const mode = ladder.modes[step]
  if (failure != null || mode == null) {
    return {
      status: PLAYBACK_STATUSES.unplayable,
      problems: failure != null ? [failure, ...plan.problems] : plan.problems,
      tryAnyway: failure == null && !forced ? () => setForced(true) : null,
    }
  }
  return {
    status: PLAYBACK_STATUSES.playing,
    mode,
    fail: (message) => {
      if (step + 1 < ladder.modes.length) setFallback({ ladder, step: step + 1 })
      else setFailure(message)
    },
    slow: lighter > step ? (delivery) => setSteppedDown({ from: mode, delivery }) : null,
    steppedDown: mode === PLAYBACK_MODES.transcode ? steppedDown : null,
    quality: mode === PLAYBACK_MODES.transcode ? quality : null,
    choice: {
      modes: ladder.modes,
      // A pick starts over from that way: what failed or was too slow before no longer holds.
      pick: (next) => {
        setPicked(next)
        setQuality(null)
        setFallback(null)
        setSteppedDown(null)
      },
      qualities: ladder.modes.includes(PLAYBACK_MODES.transcode)
        ? offeredQualities({
            media,
            maxHeight: policy?.maxHeight ?? DEFAULT_PLAYBACK_SETTINGS.maxHeight,
          })
        : [],
      quality: mode === PLAYBACK_MODES.transcode ? quality : null,
      pickQuality: (next) => {
        setPicked(PLAYBACK_MODES.transcode)
        setQuality(next)
        setFallback(null)
        setSteppedDown(null)
      },
    },
  }
}
