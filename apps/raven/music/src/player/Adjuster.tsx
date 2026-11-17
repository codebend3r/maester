import { useState } from 'react'
import {
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  View,
} from 'react-native'

import { adjusterRangeOf } from '@/player/adjusterRange'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE } from '@/theme/wrenTokens'

/** What a screen reader offers on an adjustable: a swipe up or down moves it a step. */
const ADJUST_ACTIONS = { increment: 'increment', decrement: 'decrement' } as const

const ADJUST_ACTION_LIST = [{ name: ADJUST_ACTIONS.increment }, { name: ADJUST_ACTIONS.decrement }]

type AdjusterProps = {
  label: string
  /** Where it stands, from 0 to `max`. */
  value: number
  max: number
  /** How far a screen reader's swipe moves it. */
  step: number
  /** What it is said to stand at: "1:02 of 4:44", "80%". */
  valueText: (value: number) => string
  /** Called once, as the finger lifts or a swipe lands, with where it was left. */
  onChange: (value: number) => void
}

/**
 * A line a finger sets by touching or sliding along it, the part up to its value filled and a
 * round thumb where it stands: the scrubber and the volume. A screen reader moves it a `step`
 * at a time. React Native has no slider of its own, and Wren takes no native one for this.
 */
export function Adjuster({ label, value, max, step, valueText, onChange }: AdjusterProps) {
  const styles = useStyles()
  const [width, setWidth] = useState(0)
  // Where the finger holds it, shown in place of `value` until it lifts.
  const [held, setHeld] = useState<number | null>(null)
  const within = (at: number): number => Math.min(max, Math.max(0, at))
  const valueAt = ({ nativeEvent }: GestureResponderEvent): number =>
    width > 0 ? within((nativeEvent.locationX / width) * max) : value
  const shown = held ?? value
  const share = max > 0 ? within(shown) / max : 0
  return (
    <View
      accessibilityActions={ADJUST_ACTION_LIST}
      accessibilityLabel={label}
      accessibilityRole="adjustable"
      accessibilityValue={{
        ...adjusterRangeOf({ value: shown, max, step }),
        text: valueText(shown),
      }}
      accessible
      onAccessibilityAction={({ nativeEvent }: AccessibilityActionEvent) => {
        if (nativeEvent.actionName === ADJUST_ACTIONS.increment) onChange(within(value + step))
        if (nativeEvent.actionName === ADJUST_ACTIONS.decrement) onChange(within(value - step))
      }}
      onLayout={({ nativeEvent }: LayoutChangeEvent) => setWidth(nativeEvent.layout.width)}
      onResponderGrant={(event) => setHeld(valueAt(event))}
      onResponderMove={(event) => setHeld(valueAt(event))}
      onResponderRelease={(event) => {
        setHeld(null)
        onChange(valueAt(event))
      }}
      onResponderTerminate={() => setHeld(null)}
      // A list scrolling under the finger would otherwise take the touch and drop the scrub.
      onResponderTerminationRequest={() => false}
      onStartShouldSetResponder={() => true}
      style={styles.adjuster}
    >
      <View pointerEvents="none" style={styles.line}>
        <View style={[styles.filled, { width: `${share * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[styles.thumb, { left: share * width - SIZE.scrubThumb / 2 }]}
      />
    </View>
  )
}

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  adjuster: { justifyContent: 'center', minHeight: SIZE.touchTarget },
  line: {
    backgroundColor: colors.line2,
    borderRadius: RADIUS.pill,
    height: SIZE.scrubTrack,
    overflow: 'hidden',
  },
  filled: { backgroundColor: colors.text, height: '100%' },
  thumb: {
    backgroundColor: colors.text,
    borderRadius: RADIUS.pill,
    height: SIZE.scrubThumb,
    position: 'absolute',
    width: SIZE.scrubThumb,
  },
}))
