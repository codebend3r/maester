import type { Marker } from '@raven/core'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUpNextCountdown } from '@/lib/useUpNextCountdown'
import { useHostServices } from '@/stores/playerServices'

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
  const next = useHostServices((services) => services.title.next)
  const wasEnded = useRef(false)
  const hasLeft = useRef(false)
  const playNext = () => {
    if (!next || hasLeft.current) return
    hasLeft.current = true
    Promise.resolve(navigate(next.to, { replace: true, state: next.state })).catch(() => undefined)
  }
  const {
    isOffered,
    countdown,
    secondsLeft,
    hasSceneAfter,
    autoplay,
    shouldPlayItself,
    isDismissed,
    dismiss,
  } = useUpNextCountdown({
    time,
    duration,
    credits,
    hasNext: next != null,
    canPlayItself: next !== null && !next.isNextSeason,
    onDue: playNext,
  })
  const onEnded = useEffectEvent(playNext)
  useEffect(() => {
    if (ended && !wasEnded.current && shouldPlayItself) onEnded()
    wasEnded.current = ended
  }, [ended, shouldPlayItself])
  const isInCredits = credits != null && time >= credits.start && time < credits.end
  return {
    next,
    autoplay,
    playNext,
    countdown,
    secondsLeft,
    isCardShown: isOffered,
    hasSceneAfter,
    dismiss,
    /** To the scene after the credits, once Watch credits put the card away; null otherwise. */
    skipCredits:
      isDismissed && hasSceneAfter && isInCredits && credits != null
        ? () => seek(credits.end)
        : null,
  }
}
