import { type MediaItem, type PlaybackMode, planPlayback } from '@raven/core'
import { useMemo, useState } from 'react'
import { browserCanPlay, browserCanStream } from '@/lib/canPlay'
import { usePlaybackPolicy } from '@/lib/usePlaybackPolicy'

/** The ways to play, best first, for one audio track; a step down belongs to one ladder. */
type Ladder = { modes: readonly PlaybackMode[]; audio: number | null }

const sameLadder = (a: Ladder, b: Ladder): boolean =>
  a.audio === b.audio &&
  a.modes.length === b.modes.length &&
  a.modes.every((mode, index) => mode === b.modes[index])

export type PlaybackStatus =
  /** What picks the first source, the server's playback settings, is on its way. */
  | { status: 'waiting' }
  | { status: 'unplayable'; problems: string[]; tryAnyway: (() => void) | null }
  /** `fail` steps down to the next way, or gives up once none is left. */
  | { status: 'playing'; mode: PlaybackMode; fail: (message: string) => void }

/**
 * How to play a file. The original goes straight to the browser when it can
 * take it; otherwise, or for any audio track but the default, the server
 * converts it. When a way fails mid-play, the next one down is tried, and
 * only when every way has failed is the file unplayable. A new audio track
 * starts again at the top.
 */
export const usePlaybackLadder = ({
  media,
  audio,
  isDefaultAudio,
}: {
  media: MediaItem
  audio: number | null
  isDefaultAudio: boolean
}): PlaybackStatus => {
  const policy = usePlaybackPolicy()
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

  // The server's settings say whether to force the original file and what it
  // converts; a plan made without them starts a stream it may refuse.
  if (!plan) return { status: 'waiting' }

  const ladder: Ladder = {
    modes: plan.modes.length === 0 && forced ? ['direct'] : plan.modes,
    audio,
  }
  const step = fallback != null && sameLadder(fallback.ladder, ladder) ? fallback.step : 0
  const mode = ladder.modes[step]
  if (failure != null || mode == null) {
    return {
      status: 'unplayable',
      problems: failure != null ? [failure, ...plan.problems] : plan.problems,
      tryAnyway: failure == null && !forced ? () => setForced(true) : null,
    }
  }
  return {
    status: 'playing',
    mode,
    fail: (message) => {
      if (step + 1 < ladder.modes.length) setFallback({ ladder, step: step + 1 })
      else setFailure(message)
    },
  }
}
