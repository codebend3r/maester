import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostServices } from '@/stores/playerServices'

/** How many seconds before the end the countdown to what is up next starts. */
export const AUTOPLAY_COUNTDOWN_SECONDS = 10

/**
 * How far the countdown to what is up next has run, 0 to 1, in the last
 * seconds of the video; null before then, with autoplay off, or with nothing
 * up next. A video shorter than the countdown counts down the whole way.
 */
const countdownAt = ({
  time,
  duration,
  isCounting,
}: {
  time: number
  duration: number | null
  isCounting: boolean
}): number | null => {
  if (!isCounting || duration == null || duration <= 0) return null
  const span = Math.min(AUTOPLAY_COUNTDOWN_SECONDS, duration)
  const into = time - (duration - span)
  return into < 0 ? null : Math.min(1, into / span)
}

/**
 * What plays next, and the countdown to it. With autoplay on, a transition
 * to ended replaces the current watch entry with it; with autoplay off it
 * waits for a click.
 */
export const useUpNext = ({
  ended,
  time,
  duration,
}: {
  ended: boolean
  time: number
  duration: number | null
}) => {
  const navigate = useNavigate()
  const {
    title: { next },
  } = useHostServices()
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const wasEnded = useRef(false)
  useEffect(() => {
    if (ended && !wasEnded.current && next && autoplay) {
      void navigate(next.to, { replace: true, state: next.state })
    }
    wasEnded.current = ended
  }, [ended, next, autoplay, navigate])
  return {
    next,
    autoplay,
    countdown: countdownAt({ time, duration, isCounting: autoplay && next != null }),
  }
}
