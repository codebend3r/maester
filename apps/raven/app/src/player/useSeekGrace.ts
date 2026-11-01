import { useEffect, useEffectEvent } from 'react'

import { SEEK_GRACE_MS, START_PHASES, type StartState } from '@/player/startUp'

type UseSeekGraceProps = {
  state: StartState
  /** Says the attempt's resume seek is over, though the player never reported it. */
  onLanded: (attempt: number) => void
}

/** Lets a video play `SEEK_GRACE_MS` after its resume seek was asked, for a seek never reported. */
export const useSeekGrace = ({ state, onLanded }: UseSeekGraceProps): void => {
  const attempt = state?.phase === START_PHASES.seeking ? state.attempt : null
  const land = useEffectEvent(onLanded)
  useEffect(() => {
    if (attempt === null) return undefined
    const timer = setTimeout(() => land(attempt), SEEK_GRACE_MS)
    return () => clearTimeout(timer)
  }, [attempt])
}
