import { type TVRemoteEvent } from 'react-native'
import { useEffect, useReducer } from 'react'

import { HOLD_ACTIONS, HOLD_TICK_MS, holdReducer } from '@/layouts/heldSeek'
import type { Transport } from '@/layouts/playerKit'
import { heldSeekOf } from '@/layouts/remoteKeys'

type UseHeldSeekProps = {
  transport: Transport | null
  /** Whether left and right seek now (`isSeekingWith`), read as each held key goes down. */
  isSeeking: () => boolean
}

/**
 * Holding left or right on the d-pad: while the key is down the playhead runs, faster the longer
 * it is held, and the video seeks there once as the key comes up. `respond` takes a remote event
 * and says whether it was a hold's; `transport` is the one to draw, its position the hold's while
 * one runs, and `isHolding` says one runs, so the controls stay up until the key comes up;
 * `direction` is the way it runs, null while none does.
 */
export const useHeldSeek = ({ transport, isSeeking }: UseHeldSeekProps) => {
  const [hold, dispatch] = useReducer(holdReducer, null)
  const isHolding = hold !== null
  const duration = transport?.duration ?? null

  useEffect(() => {
    if (!isHolding) return undefined
    const ticker = setInterval(
      () => dispatch({ type: HOLD_ACTIONS.tick, now: Date.now(), duration }),
      HOLD_TICK_MS,
    )
    return () => clearInterval(ticker)
  }, [isHolding, duration])

  const respond = (event: TVRemoteEvent): boolean => {
    const held = heldSeekOf(event)
    if (held === null || transport === null) return false
    if (held.isDown) {
      if (!isSeeking()) return false
      dispatch({
        type: HOLD_ACTIONS.down,
        direction: held.direction,
        at: transport.position,
        now: Date.now(),
      })
      return true
    }
    if (hold === null) return false
    transport.onSeek(hold.at)
    dispatch({ type: HOLD_ACTIONS.up })
    return true
  }

  const shown =
    transport === null || hold === null ? transport : { ...transport, position: hold.at }
  return { respond, transport: shown, isHolding, direction: hold?.direction ?? null }
}
