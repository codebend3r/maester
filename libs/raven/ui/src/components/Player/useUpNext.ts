import type { Marker } from '@raven/core'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostServices } from '@/stores/playerServices'

/** Credits that end this close to the file's end leave nothing after them. */
const SCENE_AFTER_MIN_S = 2

type CountdownSpanProps = {
  duration: number | null
  seconds: number
  credits: Marker | null
}

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
}: CountdownSpanProps): { start: number; end: number } | null => {
  if (duration == null || duration <= 0) return null
  const lastSeconds = duration - Math.min(seconds, duration)
  const start = credits == null ? lastSeconds : Math.max(0, Math.min(credits.start, lastSeconds))
  return { start, end: Math.min(duration, start + seconds) }
}

type CountdownAtProps = {
  time: number
  span: { start: number; end: number } | null
}

/** How far the countdown has run, 0 to 1; null before it starts. */
const countdownAt = ({ time, span }: CountdownAtProps): number | null => {
  if (span == null || time < span.start) return null
  const length = span.end - span.start
  return length <= 0 ? 1 : Math.min(1, (time - span.start) / length)
}

type UseUpNextProps = {
  ended: boolean
  time: number
  duration: number | null
  /** The file's credits; without them the countdown runs over the video's last seconds. */
  credits: Marker | null
  seek: (time: number) => void
}

/**
 * What plays next, the card that offers it from the credits on, the
 * countdown to it, and `playNext` to play it now. The card shows from the
 * countdown's start until Watch credits dismisses it for this title. With
 * autoplay on, the countdown runs the viewer's `autoplayCountdownSeconds`
 * and what is next replaces the current watch entry when it runs out, or
 * when the video ends after Watch credits. With autoplay off, or for the
 * next season after a season played on its own, it waits for a click.
 * Once the card is dismissed, credits with a scene after them offer
 * `skipCredits` to that scene.
 */
export const useUpNext = ({ ended, time, duration, credits, seek }: UseUpNextProps) => {
  const navigate = useNavigate()
  const {
    title: { next },
  } = useHostServices()
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const seconds = usePlayerPrefs((prefs) => prefs.autoplayCountdownSeconds)
  const [isDismissed, setDismissed] = useState(false)
  const wasEnded = useRef(false)
  const hasLeft = useRef(false)
  const shouldPlayItself = autoplay && next != null && next.isNextSeason !== true
  const playNext = () => {
    if (!next || hasLeft.current) return
    hasLeft.current = true
    void navigate(next.to, { replace: true, state: next.state })
  }
  const onDue = useEffectEvent(playNext)
  const span = countdownSpan({ duration, seconds, credits })
  const countdown = shouldPlayItself && !isDismissed ? countdownAt({ time, span }) : null
  const isRunOut = countdown === 1
  useEffect(() => {
    if (isRunOut) onDue()
  }, [isRunOut])
  useEffect(() => {
    if (ended && !wasEnded.current && shouldPlayItself) onDue()
    wasEnded.current = ended
  }, [ended, shouldPlayItself])
  const hasSceneAfter =
    credits != null && duration != null && duration - credits.end > SCENE_AFTER_MIN_S
  const isInCredits = credits != null && time >= credits.start && time < credits.end
  return {
    next,
    autoplay,
    playNext,
    countdown,
    /** Whole seconds until what is next plays by itself; null while nothing counts down. */
    secondsLeft: countdown != null && span != null ? Math.max(0, Math.ceil(span.end - time)) : null,
    isCardShown: next != null && span != null && time >= span.start && !isDismissed,
    hasSceneAfter,
    dismiss: () => setDismissed(true),
    /** To the scene after the credits, once Watch credits put the card away; null otherwise. */
    skipCredits:
      isDismissed && hasSceneAfter && isInCredits && credits != null
        ? () => seek(credits.end)
        : null,
  }
}
