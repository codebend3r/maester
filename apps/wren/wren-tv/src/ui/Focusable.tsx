import { type ComponentRef, type ReactNode, useRef } from 'react'
import {
  type AccessibilityRole,
  type AccessibilityState,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { OPACITIES, SIZE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { useFocusOnceDrawn } from '@/ui/useFocusOnceDrawn'

/** What a focusable control knows of itself as it draws: whether the remote is on it. */
type FocusState = { isFocused: boolean }

/** The roles a focusable control takes, as React Native's accessibility names them. */
export const FOCUS_ROLES = {
  button: 'button',
  link: 'link',
  radio: 'radio',
  checkbox: 'checkbox',
  switch: 'switch',
  tab: 'tab',
} as const satisfies Record<string, AccessibilityRole>

type FocusRole = (typeof FOCUS_ROLES)[keyof typeof FOCUS_ROLES]

/**
 * The roles that say whether they are on as `checked`, as the phone's choices and its Like and
 * Follow do; every other role says it as `selected`: a tab, and a toggle drawn as a button.
 */
const CHECKED_ROLES: ReadonlySet<FocusRole> = new Set([
  FOCUS_ROLES.radio,
  FOCUS_ROLES.checkbox,
  FOCUS_ROLES.switch,
])

type StateOfProps = { role: FocusRole; isSelected: boolean | undefined; isDisabled: boolean }

/** What a screen reader hears of a control's state: whether it is off, and whether it is on. */
const stateOf = ({ role, isSelected, isDisabled }: StateOfProps): AccessibilityState => {
  if (isSelected === undefined) return { disabled: isDisabled }
  return CHECKED_ROLES.has(role)
    ? { disabled: isDisabled, checked: isSelected }
    : { disabled: isDisabled, selected: isSelected }
}

const useStyles = themedStyles(({ colors }) => ({
  control: { borderColor: 'transparent', borderWidth: SIZE.focusRing },
  focused: { borderColor: colors.text, transform: [{ scale: SIZE.focusScale }] },
  disabled: { opacity: OPACITIES.disabled },
}))

export type FocusableProps = {
  /** What a screen reader says, and what an end to end test finds it by. */
  label: string
  /** A second line it says after the label, such as a count. */
  hint?: string
  role?: FocusRole
  onPress: () => void
  /** Holding select: a song's menu. */
  onLongPress?: () => void
  /** Whether a choice is the one picked, or a toggle is on; left out of a plain button. */
  isSelected?: boolean
  isDisabled?: boolean
  /** Whether the remote starts on this control as its screen opens. */
  hasPreferredFocus?: boolean
  onFocus?: () => void
  onBlur?: () => void
  style?: StyleProp<ViewStyle>
  /** How it looks with the remote on it, beyond the kit's ring and lift. */
  focusedStyle?: StyleProp<ViewStyle>
  /** Whether it wears the kit's ring and lift; a control that draws its own focus says no. */
  hasRing?: boolean
  children: ReactNode | ((state: FocusState) => ReactNode)
  testID?: string
}

/**
 * Every control Wren on TV draws: a `Pressable` the remote's focus engine reaches, ringed and
 * lifted while the remote is on it, so the focus reads from across the room. Its children may
 * be a function of the focus, for a tile whose words change colour with it.
 */
export function Focusable({
  label,
  hint,
  role = FOCUS_ROLES.button,
  onPress,
  onLongPress,
  isSelected,
  isDisabled = false,
  hasPreferredFocus = false,
  onFocus,
  onBlur,
  style,
  focusedStyle,
  hasRing = true,
  children,
  testID,
}: FocusableProps) {
  const styles = useStyles()
  const control = useRef<ComponentRef<typeof Pressable>>(null)
  const opening = useFocusOnceDrawn({ view: control, isAsked: hasPreferredFocus })
  const reached = () => {
    opening.onReached()
    onFocus?.()
  }
  return (
    <Pressable
      ref={control}
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole={role}
      accessibilityState={stateOf({ role, isSelected, isDisabled })}
      disabled={isDisabled}
      hasTVPreferredFocus={hasPreferredFocus}
      onBlur={onBlur}
      onFocus={reached}
      onLayout={opening.onDrawn}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ focused }) => [
        hasRing && styles.control,
        style,
        focused && hasRing && styles.focused,
        focused && focusedStyle,
        isDisabled && styles.disabled,
      ]}
      testID={testID}
    >
      {({ focused }) =>
        typeof children === 'function' ? children({ isFocused: focused }) : children
      }
    </Pressable>
  )
}
