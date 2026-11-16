import { type SkipStep, stepSkip } from '@raven/core'
import { useEffect, useRef, useState } from 'react'

import type { Transport } from '@/layouts/playerKit'

/** What a skip moves: where it is and how to seek, a video's transport or the music's. */
export type SkipTarget = Pick<Transport, 'position' | 'onSeek'>

type UseSkipLadderProps = {
  /** Null while there is nothing to drive; a skip then does nothing. */
  transport: SkipTarget | null
}

/**
 * The one skip a chrome makes, whatever asked for it: a button, a key, the remote or a double
 * tap, on a video or on Now Playing's cover. Each goes by core's `stepSkip`, the web player's rule, so a skip is 10 seconds, and 20 and
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

/** The last skip a chrome shows, counted so the same one twice starts its mark afresh. */
type ShownSkip = { step: SkipStep; count: number }

/**
 * A skip ladder that keeps the last step it took, for a touch chrome to draw as a `SkipMark`
 * keyed by `count`: the video's picture and Now Playing's cover share it. A skip that took no
 * step leaves the last mark as it was.
 */
export const useSkipMark = (props: UseSkipLadderProps) => {
  const skip = useSkipLadder(props)
  const [skipped, setSkipped] = useState<ShownSkip | null>(null)
  const skipBy = (direction: SkipStep['direction']) => {
    const step = skip(direction)
    if (step !== null) setSkipped((was) => ({ step, count: (was?.count ?? 0) + 1 }))
  }
  return { skipped, skipBy }
}
