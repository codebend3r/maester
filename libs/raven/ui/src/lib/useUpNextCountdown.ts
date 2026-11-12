import { useEffect, useEffectEvent, useState } from 'react'
import { type UpNextAtProps, type UpNextMoment, upNextAt } from '@/lib/upNextCountdown'
import { usePlayerPrefs } from '@/stores/playerPrefs'

type UseUpNextCountdownProps = Pick<UpNextAtProps, 'time' | 'duration' | 'credits' | 'hasNext'> & {
  /** Whether what is next may play by itself at all; false for one that waits for a press. */
  canPlayItself: boolean
  /** Plays what is next, called once as the countdown runs out. */
  onDue: () => void
}

/** The moment's up next, the viewer's say over it, and the way to put the card away. */
type UpNextCountdown = UpNextMoment & {
  /** The viewer's autoplay setting. */
  autoplay: boolean
  /** Whether what is next plays by itself: autoplay is on and it may. */
  shouldPlayItself: boolean
  /** Whether Watch credits put the card away for this title. */
  isDismissed: boolean
  dismiss: () => void
}

/**
 * Every player's up next: `upNextAt` read with the viewer's autoplay settings, the card's
 * dismissal for this title, and `onDue` called as the countdown runs out. One mount is one
 * title, so a dismissal lasts until the player goes.
 */
export const useUpNextCountdown = ({
  time,
  duration,
  credits,
  hasNext,
  canPlayItself,
  onDue,
}: UseUpNextCountdownProps): UpNextCountdown => {
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const seconds = usePlayerPrefs((prefs) => prefs.autoplayCountdownSeconds)
  const [isDismissed, setDismissed] = useState(false)
  const shouldPlayItself = autoplay && canPlayItself
  const moment = upNextAt({
    time,
    duration,
    seconds,
    credits,
    hasNext,
    shouldPlayItself,
    isDismissed,
  })
  const isRunOut = moment.countdown === 1
  const due = useEffectEvent(onDue)
  useEffect(() => {
    if (isRunOut) due()
  }, [isRunOut])
  return { ...moment, autoplay, shouldPlayItself, isDismissed, dismiss: () => setDismissed(true) }
}
