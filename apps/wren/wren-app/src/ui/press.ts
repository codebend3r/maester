import {
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native'

import { OPACITIES, SIZE } from '@/theme/wrenTokens'

/** How every control in the kit answers a finger and a switch: faint while held, fainter while off. */
const PRESS_STYLES = StyleSheet.create({
  pressed: { opacity: OPACITIES.pressed },
  disabled: { opacity: OPACITIES.disabled },
})

type PressedStyleOfProps = { style: StyleProp<ViewStyle>; isDisabled?: boolean }

/** A Pressable's style: its own, faint while a finger holds it and fainter while it is off. */
export const pressedStyleOf =
  ({ style, isDisabled = false }: PressedStyleOfProps) =>
  ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
    style,
    pressed && PRESS_STYLES.pressed,
    isDisabled && PRESS_STYLES.disabled,
  ]

/** How far past its edges a control smaller than a finger answers, so every target is 44. */
export const hitSlopOf = (size: number): number => Math.max(0, (SIZE.touchTarget - size) / 2)
