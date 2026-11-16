import {
  TOUCH_HOLD_DELAY_MS,
  TOUCH_HOLD_RATE,
  TOUCH_REWIND_TICK_MS,
  type TouchSide,
  rewoundTo,
  touchSideOf,
} from '@raven/core'
import { useEffect, useRef, useState } from 'react'
import type { GestureResponderEvent } from 'react-native'

import type { Transport, VideoSurface } from '@/layouts/playerKit'
import { useTapLadder } from '@/layouts/useTapLadder'

/** A finger held on the picture: its side, where and when it started, and where it has got to. */
type Hold = { side: TouchSide; from: number; startedAt: number; at: number }

type HeldPlaybackOfProps = { surface: VideoSurface; held: TouchSide | null }

/**
 * How the video plays under a held finger, laid over what the screen asked: on the right it
 * plays at the hold's speed, paused or not; on the left it stands still while the hook seeks it
 * back; with no finger held, as the screen says.
 */
export const heldPlaybackOf = ({
  surface,
  held,
}: HeldPlaybackOfProps): Pick<VideoSurface, 'paused' | 'rate'> => {
  // Named even at rest, so the player is told to leave the hold's speed as the finger lifts.
  const rate = surface.rate ?? 1
  if (held === null) return { paused: surface.paused, rate }
  return held > 0 ? { paused: false, rate: TOUCH_HOLD_RATE } : { paused: true, rate }
}

type UseSurfaceGesturesProps = {
  /** Null while there is nothing to drive; a hold then starts nothing. */
  transport: Transport | null
  /** The picture's width, which the finger's side is read against. */
  width: number
  /** A double tap's skip, and each tap that goes on from it. */
  onSkip: (direction: TouchSide) => void
  /** A tap's own answer, showing or hiding the controls. */
  onTap: () => void
}

/**
 * A finger on the picture under the thumb: its taps are `useTapLadder`'s, a double tap on the
 * right half skipping forward and on the left half back, a lone tap `onTap`, the pair leaving the
 * controls as it found them. `held` is the side a finger rests on, null
 * while none does: the chrome plays the right at twice the speed, and holds the left paused
 * while this seeks it back at twice the speed every tick, since neither platform's player runs
 * in reverse. `transport` is the one to draw, its position the hold's while one runs back.
 */
export const useSurfaceGestures = ({
  transport,
  width,
  onSkip,
  onTap,
}: UseSurfaceGesturesProps) => {
  const latest = useRef(transport)
  useEffect(() => {
    latest.current = transport
  })
  const taps = useTapLadder({ onSkip, onTap })
  const [hold, setHold] = useState<Hold | null>(null)
  const isRewinding = hold !== null && hold.side < 0
  const rewoundAt = isRewinding ? hold.at : null

  useEffect(() => {
    if (!isRewinding) return undefined
    const ticker = setInterval(
      () =>
        setHold((was) =>
          was === null
            ? null
            : { ...was, at: rewoundTo({ from: was.from, heldMs: Date.now() - was.startedAt }) },
        ),
      TOUCH_REWIND_TICK_MS,
    )
    return () => clearInterval(ticker)
  }, [isRewinding])

  useEffect(() => {
    if (rewoundAt !== null) latest.current?.onSeek(rewoundAt)
  }, [rewoundAt])

  const sideOf = ({ nativeEvent }: GestureResponderEvent): TouchSide =>
    touchSideOf({ x: nativeEvent.pageX, width })

  const onPress = (event: GestureResponderEvent) => taps.tap(sideOf(event))

  const onLongPress = (event: GestureResponderEvent) => {
    const current = latest.current
    if (current === null) return
    taps.forget()
    setHold({
      side: sideOf(event),
      from: current.position,
      startedAt: Date.now(),
      at: current.position,
    })
  }

  const release = () => setHold(null)

  const shown =
    transport === null || rewoundAt === null ? transport : { ...transport, position: rewoundAt }
  return {
    held: hold?.side ?? null,
    transport: shown,
    surfaceProps: {
      delayLongPress: TOUCH_HOLD_DELAY_MS,
      onPress,
      onLongPress,
      // The finger lifting, or the system taking the touch, ends a hold wherever it has got to.
      onTouchEnd: release,
      onTouchCancel: release,
    },
  }
}
