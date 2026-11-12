import type { Marker } from '@raven/core'

/** Credits that end this close to the file's end leave nothing after them. */
const SCENE_AFTER_MIN_S = 2

type CountdownSpanProps = {
  duration: number | null
  seconds: number
  credits: Marker | null
}

type CountdownSpan = { start: number; end: number }

/**
 * When the countdown to what is up next starts and runs out. It starts at
 * the credits, or in the video's last `seconds` when those come first or
 * the credits are unknown, and runs for `seconds`, never past the end. A
 * video shorter than the countdown counts down the whole way. Null while
 * the video's length is unknown.
 */
const countdownSpan = ({
  duration,
  seconds,
  credits,
}: CountdownSpanProps): CountdownSpan | null => {
  if (duration == null || duration <= 0) return null
  const lastSeconds = duration - Math.min(seconds, duration)
  const start = credits == null ? lastSeconds : Math.max(0, Math.min(credits.start, lastSeconds))
  return { start, end: Math.min(duration, start + seconds) }
}

type RunOfProps = { time: number; span: CountdownSpan }

/** How far the countdown has run, 0 to 1. */
const runOf = ({ time, span }: RunOfProps): number => {
  const length = span.end - span.start
  return length <= 0 ? 1 : Math.min(1, (time - span.start) / length)
}

/** What a player shows of what is up next at one moment of the video. */
export type UpNextMoment = {
  /** Whether the card that offers what is next shows. */
  isOffered: boolean
  /** How far the countdown has run, 0 to 1; null while what is next waits for a press. */
  countdown: number | null
  /** Whole seconds until what is next plays by itself; null while nothing counts down. */
  secondsLeft: number | null
  /** The credits end before the file does: a scene follows them. */
  hasSceneAfter: boolean
}

export type UpNextAtProps = CountdownSpanProps & {
  time: number
  /** Whether anything plays after this video. */
  hasNext: boolean
  /** Whether what is next plays by itself once the countdown runs out. */
  shouldPlayItself: boolean
  /** Whether Watch credits put the card away for this title. */
  isDismissed: boolean
}

/**
 * What every player shows of what is up next at `time`. The card is offered
 * from the countdown's start (the credits, or the video's last `seconds`)
 * until it is dismissed; the countdown runs only while what is next plays by
 * itself, and is 1 once it has run out.
 */
export const upNextAt = ({
  time,
  duration,
  seconds,
  credits,
  hasNext,
  shouldPlayItself,
  isDismissed,
}: UpNextAtProps): UpNextMoment => {
  const hasSceneAfter =
    credits != null && duration != null && duration - credits.end > SCENE_AFTER_MIN_S
  const span = countdownSpan({ duration, seconds, credits })
  if (!hasNext || isDismissed || span === null || time < span.start) {
    return { isOffered: false, countdown: null, secondsLeft: null, hasSceneAfter }
  }
  if (!shouldPlayItself) {
    return { isOffered: true, countdown: null, secondsLeft: null, hasSceneAfter }
  }
  return {
    isOffered: true,
    countdown: runOf({ time, span }),
    secondsLeft: Math.max(0, Math.ceil(span.end - time)),
    hasSceneAfter,
  }
}
