import { TOUCH_DRIFT_PX, TOUCH_HOLD_DELAY_MS } from '@raven/core'
import { type DOMAttributes, type PointerEvent, useEffect, useRef } from 'react'

/** The pointer a long press is for; a mouse's press stays a click. */
const POINTER_TYPES = { touch: 'touch' } as const

/** A finger resting where it went down. */
type Press = { x: number; y: number }

type UseLongPressProps = {
  /** Heard once a finger has rested on the element for the hold's delay, or on a right click. */
  onLongPress: () => void
}

/** What the held element is given: the pointer's handlers, and the click and menu it keeps from the page. */
export type LongPressHandlers = Required<
  Pick<
    DOMAttributes<HTMLElement>,
    | 'onPointerDown'
    | 'onPointerMove'
    | 'onPointerUp'
    | 'onPointerCancel'
    | 'onPointerLeave'
    | 'onTouchEnd'
    | 'onClickCapture'
    | 'onContextMenu'
  >
>

/**
 * A finger resting on an element for `TOUCH_HOLD_DELAY_MS` (the player's hold too) without
 * drifting past `TOUCH_DRIFT_PX` calls `onLongPress`; lifting, drifting, leaving or the browser
 * taking the touch for a scroll lets go first, so a short tap stays the element's own. Once it
 * has held, the lift's touchend is cancelled and the click it would still send is swallowed in
 * the capture phase, so a cover that is a link or a button does not open as well. A mouse is
 * never held, but its right click, like the menu Android raises on a held link, calls
 * `onLongPress` in the browser's menu's place, and only once for a finger that already held.
 */
export const useLongPress = ({ onLongPress }: UseLongPressProps): LongPressHandlers => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const press = useRef<Press | null>(null)
  const hasHeld = useRef(false)

  const letGo = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    press.current = null
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const hold = (): void => {
    letGo()
    hasHeld.current = true
    onLongPress()
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    // A hold no click followed (Android sends none after its menu) leaves nothing for the next press.
    hasHeld.current = false
    if (event.pointerType !== POINTER_TYPES.touch) return
    letGo()
    press.current = { x: event.clientX, y: event.clientY }
    timer.current = setTimeout(hold, TOUCH_HOLD_DELAY_MS)
  }

  // A finger that wanders off is a scroll, never a hold.
  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const from = press.current
    if (from === null) return
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > TOUCH_DRIFT_PX) letGo()
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: letGo,
    onPointerCancel: letGo,
    onPointerLeave: letGo,
    // Cancelling the lift's touchend keeps the browser from making a click of it at all.
    onTouchEnd: (event) => {
      if (hasHeld.current) event.preventDefault()
    },
    onClickCapture: (event) => {
      if (!hasHeld.current) return
      hasHeld.current = false
      event.preventDefault()
      event.stopPropagation()
    },
    onContextMenu: (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (press.current !== null) {
        hold()
        return
      }
      if (!hasHeld.current) onLongPress()
    },
  }
}
