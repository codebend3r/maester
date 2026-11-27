import { type WrenIconName } from '@raven/wren'
import { type AccessibilityRole, Pressable } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme, shadowOf } from '@/theme/wrenTheme'
import { RADIUS, SHADOWS, SIZE } from '@/theme/wrenTokens'
import { hitSlopOf, pressedStyleOf } from '@/ui/press'
import { WrenIcon } from '@/ui/WrenIcon'

/** An icon button's ground: none, a quiet fill, or a ring. */
export const ICON_BUTTON_VARIANTS = {
  plain: 'plain',
  filled: 'filled',
  outlined: 'outlined',
} as const

type IconButtonVariant = (typeof ICON_BUTTON_VARIANTS)[keyof typeof ICON_BUTTON_VARIANTS]

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  button: { alignItems: 'center', borderRadius: RADIUS.pill, justifyContent: 'center' },
  [ICON_BUTTON_VARIANTS.plain]: {},
  [ICON_BUTTON_VARIANTS.filled]: { backgroundColor: colors.surface2 },
  [ICON_BUTTON_VARIANTS.outlined]: { borderColor: colors.line2, borderWidth: SIZE.hairline },
  // The card's shadow, the web's `--shadow-card`.
  lifted: shadowOf({ shadow: SHADOWS.card, color: colors.shadow }),
}))

/** How far a lifted circle rides above where it sits, as a share of its size: the web's too. */
const LIFT_SHARE = 0.25

/** The icon's size for a button's size: about half of it, from 18 to 26. */
const iconSizeOf = (size: number): number =>
  Math.min(SIZE.largeIcon, Math.max(SIZE.smallIcon, Math.round(size / 2)))

type IconButtonProps = {
  icon: WrenIconName
  /** What the button is called aloud; it shows no words. */
  label: string
  onPress: () => void
  variant?: IconButtonVariant
  /** The circle's width, 36 to 56; anything under 44 still answers a 44 point finger. */
  size?: number
  iconSize?: number
  /** The icon's colour, `text2` unless the place asks for another. */
  color?: string
  /** Fills the circle with this colour instead: the tablet's play button in `text`. */
  fill?: string
  /** The circle rides above where it sits, bleeding past the bar's top edge. */
  isLifted?: boolean
  isDisabled?: boolean
  /** A toggle's state, said aloud: Shuffle on, Like on. */
  isSelected?: boolean
  role?: AccessibilityRole
}

/** A round button drawn as its icon alone, always named for a screen reader. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = ICON_BUTTON_VARIANTS.plain,
  size = SIZE.touchTarget,
  iconSize = iconSizeOf(size),
  color,
  fill,
  isLifted = false,
  isDisabled = false,
  isSelected,
  role = 'button',
}: IconButtonProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={role}
      accessibilityState={{ disabled: isDisabled, selected: isSelected }}
      disabled={isDisabled}
      hitSlop={hitSlopOf(size)}
      onPress={onPress}
      style={pressedStyleOf({
        style: [
          styles.button,
          styles[variant],
          { width: size, height: size },
          fill !== undefined && { backgroundColor: fill },
          isLifted && [styles.lifted, { transform: [{ translateY: -size * LIFT_SHARE }] }],
        ],
        isDisabled,
      })}
    >
      <WrenIcon color={color ?? colors.text2} name={icon} size={iconSize} />
    </Pressable>
  )
}
