import { type SurfaceTap, type TouchSide, stepTap } from '@raven/core'
import { useRef } from 'react'

type UseTapLadderProps = {
  /** A double tap's skip that way, and each quick tap that goes on from it. */
  onSkip: (side: TouchSide) => void
  /** A lone tap's own answer; the double tap's second calls it again, so the pair undoes it. */
  onTap: () => void
}

/**
 * Taps on a surface split in halves, by the web player's rules (core's `stepTap`): a double tap
 * on the right half skips forward and on the left half back, each further quick tap skipping
 * again, and a lone tap is `onTap` at once. The video's picture and Now Playing's cover share it.
 * `forget` drops the last tap, for a hold that starts in its place.
 */
export const useTapLadder = ({ onSkip, onTap }: UseTapLadderProps) => {
  const last = useRef<SurfaceTap | null>(null)
  const tap = (side: TouchSide) => {
    const hasSkipped = last.current?.isSkip ?? false
    const step = stepTap({ last: last.current, side, at: Date.now() })
    last.current = step
    if (!step.isSkip) {
      onTap()
      return
    }
    if (!hasSkipped) onTap()
    onSkip(side)
  }
  const forget = () => {
    last.current = null
  }
  return { tap, forget }
}
