import {
  DOUBLE_TAP_MS,
  type SurfaceTap,
  TOUCH_HOLD_DELAY_MS,
  TOUCH_HOLD_RATE,
  TOUCH_REWIND_TICK_MS,
  type TouchSide,
  rewoundTo,
  stepTap,
  touchSideOf,
} from '@raven/core'
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { type EngineHandle, SURFACE_SELECTOR } from '@/components/Player/engine'

/** The pointer the gestures are for; a mouse keeps its click and double click. */
const POINTER_TYPES = { touch: 'touch' } as const

/** How far a resting finger may drift, in CSS pixels, and still start a hold. */
const DRIFT_PX = 10

/** A click this soon after a hold ended is the lifting finger's, not a tap. */
const HOLD_CLICK_MS = 500

/** A hold as it runs: its side, where and when it started, and what to put back as it ends. */
type Hold = {
  side: TouchSide
  from: number
  startedAt: number
  isPausedAfter: boolean
  rate: number
}

type Press = { x: number; y: number }

/** What may be waiting to fire: a lone tap's answer, a resting finger's hold, a hold's next step back. */
const TIMERS = { tap: 'tap', hold: 'hold', rewind: 'rewind' } as const

type Timers = Record<keyof typeof TIMERS, number | null>

const NO_TIMERS: Timers = { tap: null, hold: null, rewind: null }

type UseTouchGesturesProps = {
  engine: EngineHandle
  /** A double tap's skip, and each tap that goes on from it. */
  onSkip: (direction: TouchSide) => void
  /** A lone tap, once no second one followed it. */
  onTap: () => void
}

const isSurface = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest(SURFACE_SELECTOR)

type PointEvent = Pick<MouseEvent<HTMLElement>, 'clientX' | 'currentTarget'>

/** The half of the stage an event landed on. */
const sideOf = ({ clientX, currentTarget }: PointEvent): TouchSide => {
  const box = currentTarget.getBoundingClientRect()
  return touchSideOf({ x: clientX - box.left, width: box.width })
}

/**
 * A finger on the picture, for the stage to spread over its root: a double tap on the right half
 * skips forward and on the left half back, each further quick tap skipping again (core's
 * `stepTap`), and a lone tap is `onTap` once the double tap's window has passed. A finger held
 * on the right plays at twice the speed until it lifts; held on the left the video runs
 * backwards at twice the speed, as a pause sought back every tick, since no engine plays in
 * reverse. `hold` is the side held, null while none is. Only touches on the picture count: a
 * mouse, and a touch on any control, are left as they were.
 */
export const useTouchGestures = (props: UseTouchGesturesProps) => {
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  const isTouch = useRef(false)
  const lastTap = useRef<SurfaceTap | null>(null)
  const press = useRef<Press | null>(null)
  const running = useRef<Hold | null>(null)
  const heldUntil = useRef(Number.NEGATIVE_INFINITY)
  const timers = useRef<Timers>(NO_TIMERS)
  const [hold, setHold] = useState<TouchSide | null>(null)

  // One id pool holds timeouts and intervals alike, so `clearTimeout` stops either.
  const stop = (name: keyof Timers) => {
    const id = timers.current[name]
    if (id !== null) window.clearTimeout(id)
    timers.current = { ...timers.current, [name]: null }
  }
  const wait = (waiting: Partial<Timers>) => {
    timers.current = { ...timers.current, ...waiting }
  }

  // Nothing fires once the stage has gone.
  useEffect(
    () => () =>
      Object.values(timers.current)
        .filter((id) => id !== null)
        .forEach((id) => window.clearTimeout(id)),
    [],
  )

  const rewind = () => {
    const current = running.current
    if (current === null) return
    latest.current.engine.actions.seek(
      rewoundTo({ from: current.from, heldMs: performance.now() - current.startedAt }),
    )
  }

  const startHold = (side: TouchSide) => {
    const { state, position, actions } = latest.current.engine
    running.current = {
      side,
      from: position.current,
      startedAt: performance.now(),
      isPausedAfter: state.paused,
      rate: state.rate,
    }
    // The first tap of this press is no half of a double tap.
    stop(TIMERS.tap)
    lastTap.current = null
    setHold(side)
    if (side > 0) {
      actions.setRate(TOUCH_HOLD_RATE)
      if (state.paused) actions.play()
      return
    }
    if (!state.paused) actions.pause()
    wait({ [TIMERS.rewind]: window.setInterval(rewind, TOUCH_REWIND_TICK_MS) })
  }

  const endHold = () => {
    const current = running.current
    if (current === null) return
    const { actions } = latest.current.engine
    if (current.side > 0) {
      actions.setRate(current.rate)
      if (current.isPausedAfter) actions.pause()
    } else {
      stop(TIMERS.rewind)
      rewind()
      if (!current.isPausedAfter) actions.play()
    }
    running.current = null
    heldUntil.current = performance.now()
    setHold(null)
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    isTouch.current = event.pointerType === POINTER_TYPES.touch
    if (!isTouch.current || !isSurface(event.target)) return
    const side = sideOf(event)
    press.current = { x: event.clientX, y: event.clientY }
    stop(TIMERS.hold)
    wait({ [TIMERS.hold]: window.setTimeout(() => startHold(side), TOUCH_HOLD_DELAY_MS) })
  }

  // A finger that wanders off is a scroll or a swipe, never a hold.
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const from = press.current
    if (from === null || running.current !== null) return
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRIFT_PX) stop(TIMERS.hold)
  }

  const onPointerEnd = () => {
    stop(TIMERS.hold)
    press.current = null
    endHold()
  }

  /*
   * In the capture phase, so a touch's click never reaches the picture's own click, which plays
   * or pauses at once: a tap waits to learn whether it is half of a double tap.
   */
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!isTouch.current || !isSurface(event.target)) return
    event.stopPropagation()
    const at = performance.now()
    if (at - heldUntil.current < HOLD_CLICK_MS) return
    const tap = stepTap({ last: lastTap.current, side: sideOf(event), at })
    lastTap.current = tap
    stop(TIMERS.tap)
    if (tap.isSkip) {
      latest.current.onSkip(tap.side)
      return
    }
    wait({ [TIMERS.tap]: window.setTimeout(() => latest.current.onTap(), DOUBLE_TAP_MS) })
  }

  // A touch's double tap skips; it never goes on to the picture's double click, full screen.
  const onDoubleClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (isTouch.current && isSurface(event.target)) event.stopPropagation()
  }

  // A resting finger would otherwise raise the browser's menu over the hold.
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (isTouch.current && isSurface(event.target)) event.preventDefault()
  }

  return {
    hold,
    onPointerDown,
    onPointerMove,
    handlers: {
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
      onDoubleClickCapture,
      onContextMenu,
    },
  }
}
