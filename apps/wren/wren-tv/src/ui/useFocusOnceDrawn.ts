import { requestTVFocus } from '@raven/native/headless'
import { type RefObject, useEffect, useRef } from 'react'

/** How often a control that opens its screen asks for the remote until it has it, and how many times at most. */
const FOCUS_ASKS = { everyMs: 200, most: 10 } as const

type UseFocusOnceDrawnProps = {
  view: RefObject<unknown>
  isAsked: boolean
}

type Asking = ReturnType<typeof setInterval> | null

const stopAsking = (asking: RefObject<Asking>): void => {
  if (asking.current !== null) clearInterval(asking.current)
  asking.current = null
}

/** What the control hands its host view: when it is laid out, and when the remote reaches it. */
type FocusOnceDrawn = { onDrawn: () => void; onReached: () => void }

/**
 * The asks of a control that opens its screen with the remote on it, when `isAsked` was true as
 * it mounted. `hasTVPreferredFocus` alone asks before the control is in the window, and the fork
 * retries that only once, so it asks as it is first laid out. tvOS can still refuse that one as
 * the app opens, about one launch in six, and gives the remote to the sidebar; so it asks again
 * every `FOCUS_ASKS.everyMs` until the remote reaches it, `FOCUS_ASKS.most` times at most. A
 * control the remote has reached never asks again.
 */
export const useFocusOnceDrawn = ({ view, isAsked }: UseFocusOnceDrawnProps): FocusOnceDrawn => {
  const isPending = useRef(isAsked)
  const asking = useRef<Asking>(null)
  const stop = () => stopAsking(asking)
  useEffect(() => () => stopAsking(asking), [])
  const onDrawn = () => {
    if (!isPending.current) return
    isPending.current = false
    let asks = 0
    const ask = () => {
      asks += 1
      if (asks >= FOCUS_ASKS.most) stop()
      requestTVFocus(view.current)
    }
    asking.current = setInterval(ask, FOCUS_ASKS.everyMs)
    ask()
  }
  return { onDrawn, onReached: stop }
}
