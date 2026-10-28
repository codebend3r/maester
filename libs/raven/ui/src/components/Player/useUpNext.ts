import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostServices } from '@/stores/playerServices'

type WindowStartProps = {
  duration: number | null
  seconds: number
}

/** When the last `seconds` of the video start; a video shorter than them starts there. Null while its length is unknown. */
const windowStart = ({ duration, seconds }: WindowStartProps): number | null => {
  if (duration == null || duration <= 0) return null
  return duration - Math.min(seconds, duration)
}

type CountdownAtProps = {
  time: number
  start: number | null
  duration: number | null
}

/** How far the countdown has run from `start` to the video's end, 0 to 1; null before it starts. */
const countdownAt = ({ time, start, duration }: CountdownAtProps): number | null => {
  if (start == null || duration == null || time < start) return null
  const span = duration - start
  return span <= 0 ? 1 : Math.min(1, (time - start) / span)
}

type UseUpNextProps = {
  ended: boolean
  time: number
  duration: number | null
}

/**
 * What plays next, the card that offers it in the video's last seconds, the
 * countdown to it, and `playNext` to play it now. The card shows for the
 * viewer's `autoplayCountdownSeconds` before the end until Watch credits
 * dismisses it for this title. With autoplay on, the countdown runs over the
 * same seconds and a transition to ended replaces the current watch entry
 * with what is next; with autoplay off, or for the next season after a
 * season played on its own, it waits for a click.
 */
export const useUpNext = ({ ended, time, duration }: UseUpNextProps) => {
  const navigate = useNavigate()
  const {
    title: { next },
  } = useHostServices()
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const seconds = usePlayerPrefs((prefs) => prefs.autoplayCountdownSeconds)
  const [isDismissed, setDismissed] = useState(false)
  const wasEnded = useRef(false)
  const shouldPlayItself = autoplay && next != null && next.isNextSeason !== true
  const playNext = () => {
    if (next) void navigate(next.to, { replace: true, state: next.state })
  }
  const onEnded = useEffectEvent(playNext)
  useEffect(() => {
    if (ended && !wasEnded.current && shouldPlayItself) onEnded()
    wasEnded.current = ended
  }, [ended, shouldPlayItself])
  const start = windowStart({ duration, seconds })
  const isInWindow = start != null && time >= start
  const countdown = shouldPlayItself ? countdownAt({ time, start, duration }) : null
  return {
    next,
    autoplay,
    playNext,
    countdown,
    /** Whole seconds until what is next plays by itself; null while nothing counts down. */
    secondsLeft:
      countdown != null && duration != null ? Math.max(0, Math.ceil(duration - time)) : null,
    isCardShown: next != null && isInWindow && !isDismissed,
    dismiss: () => setDismissed(true),
  }
}
