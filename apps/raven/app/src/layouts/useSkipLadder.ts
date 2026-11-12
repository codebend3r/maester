import { type SkipStep, stepSkip } from '@raven/core'
import { useEffect, useRef } from 'react'

import type { Transport } from '@/layouts/playerKit'

type UseSkipLadderProps = {
  /** Null while there is nothing to drive; a skip then does nothing. */
  transport: Transport | null
}

/**
 * The one skip a chrome makes, whatever asked for it: a button, a key, the remote or a double
 * tap. Each goes by core's `stepSkip`, the web player's rule, so a skip is 10 seconds, and 20 and
 * then 30 when it follows the last one the same way within a second, counted across all of them
 * together. It answers the step it took, for the chrome to show, or null when it took none.
 */
export const useSkipLadder = ({ transport }: UseSkipLadderProps) => {
  const latest = useRef(transport)
  useEffect(() => {
    latest.current = transport
  })
  const last = useRef<SkipStep | null>(null)
  return (direction: SkipStep['direction']): SkipStep | null => {
    const current = latest.current
    if (current === null) return null
    const step = stepSkip({ last: last.current, direction, at: Date.now() })
    last.current = step
    current.onSeek(current.position + step.seconds * step.direction)
    return step
  }
}
