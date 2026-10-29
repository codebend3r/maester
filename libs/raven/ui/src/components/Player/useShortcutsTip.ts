import { useEffect, useState } from 'react'
import { usePlayerPrefs } from '@/stores/playerPrefs'

const TIP_PHASES = { waiting: 'waiting', shown: 'shown', done: 'done' } as const

type TipPhase = (typeof TIP_PHASES)[keyof typeof TIP_PHASES]

type NextPhaseProps = { phase: TipPhase; isPlaying: boolean; isListOpen: boolean }

/** A due tip shows once the video plays, and is done once the full list it points to opens. */
const nextPhase = ({ phase, isPlaying, isListOpen }: NextPhaseProps): TipPhase => {
  switch (phase) {
    case TIP_PHASES.waiting:
      return isPlaying ? TIP_PHASES.shown : phase
    case TIP_PHASES.shown:
      return isListOpen ? TIP_PHASES.done : phase
    case TIP_PHASES.done:
      return phase
    default: {
      const unreachable: never = phase
      return unreachable
    }
  }
}

type UseShortcutsTipProps = { isPlaying: boolean; isListOpen: boolean }

/**
 * The keyboard tip on the first video this browser ever plays. Whether it is
 * due is read as the player opens, and it is marked seen as it shows, so it
 * never shows again, while this player keeps it until it is put away.
 */
export const useShortcutsTip = ({ isPlaying, isListOpen }: UseShortcutsTipProps) => {
  const markSeen = usePlayerPrefs((prefs) => prefs.markShortcutsTipSeen)
  const [phase, setPhase] = useState<TipPhase>(() =>
    usePlayerPrefs.getState().hasSeenShortcutsTip ? TIP_PHASES.done : TIP_PHASES.waiting,
  )
  const next = nextPhase({ phase, isPlaying, isListOpen })
  if (next !== phase) setPhase(next)
  const isShown = next === TIP_PHASES.shown
  useEffect(() => {
    if (isShown) markSeen()
  }, [isShown, markSeen])
  return { isShown, dismiss: () => setPhase(TIP_PHASES.done) }
}
