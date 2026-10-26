import { useEffect, useEffectEvent, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostServices } from '@/stores/playerServices'

/** How many seconds before the end the countdown to what is up next starts. */
export const AUTOPLAY_COUNTDOWN_SECONDS = 10

type CountdownAtProps = {
  time: number
  duration: number | null
  isCounting: boolean
}

/**
 * How far the countdown to what is up next has run, 0 to 1, in the last
 * seconds of the video; null before then, with autoplay off, or with nothing
 * up next. A video shorter than the countdown counts down the whole way.
 */
const countdownAt = ({ time, duration, isCounting }: CountdownAtProps): number | null => {
  if (!isCounting || duration == null || duration <= 0) return null
  const span = Math.min(AUTOPLAY_COUNTDOWN_SECONDS, duration)
  const into = time - (duration - span)
  return into < 0 ? null : Math.min(1, into / span)
}

type UseUpNextProps = {
  ended: boolean
  time: number
  duration: number | null
}

/**
 * What plays next, the countdown to it, and `playNext` to play it now. With
 * autoplay on, a transition to ended replaces the current watch entry with
 * it; with autoplay off it waits for a click.
 */
export const useUpNext = ({ ended, time, duration }: UseUpNextProps) => {
  const navigate = useNavigate()
  const {
    title: { next },
  } = useHostServices()
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const wasEnded = useRef(false)
  const playNext = () => {
    if (next) void navigate(next.to, { replace: true, state: next.state })
  }
  const onEnded = useEffectEvent(playNext)
  useEffect(() => {
    if (ended && !wasEnded.current && autoplay) onEnded()
    wasEnded.current = ended
  }, [ended, autoplay])
  return {
    next,
    autoplay,
    playNext,
    countdown: countdownAt({ time, duration, isCounting: autoplay && next != null }),
  }
}
