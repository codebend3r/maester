import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { type Palette } from '@raven/wren'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { UNSEEN } from '@/ui/Unseen'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

/** What a button is for: the page's action, a quieter one, an outlined one, or one that removes. */
export const BUTTON_VARIANTS = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'danger',
} as const

export type ButtonVariant = (typeof BUTTON_VARIANTS)[keyof typeof BUTTON_VARIANTS]

/** A button's height: 48, or 52 for Sign in. */
export const BUTTON_SIZES = { regular: 'regular', large: 'large' } as const

type ButtonSize = (typeof BUTTON_SIZES)[keyof typeof BUTTON_SIZES]

/** The colour each variant writes its label and draws its icon in. */
const VARIANT_INKS = {
  [BUTTON_VARIANTS.primary]: 'accentInk',
  [BUTTON_VARIANTS.secondary]: 'text',
  [BUTTON_VARIANTS.ghost]: 'text',
  [BUTTON_VARIANTS.danger]: 'accentText',
} as const satisfies Record<ButtonVariant, keyof Palette>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    gap: SPACE.s2,
    justifyContent: 'center',
    paddingHorizontal: SPACE.s5,
  },
  [BUTTON_SIZES.regular]: { minHeight: SIZE.button },
  [BUTTON_SIZES.large]: { minHeight: SIZE.buttonLarge },
  content: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2, justifyContent: 'center' },
  stretched: { flex: 1 },
  [BUTTON_VARIANTS.primary]: { backgroundColor: colors.accent },
  [BUTTON_VARIANTS.secondary]: { backgroundColor: colors.surface2 },
  [BUTTON_VARIANTS.ghost]: { borderColor: colors.line2, borderWidth: SIZE.hairline },
  [BUTTON_VARIANTS.danger]: {},
  label: TYPE.button,
  spinner: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
}))

type ButtonProps = {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  icon?: WrenIconName
  size?: ButtonSize
  /** Whether it shares its row equally with the buttons beside it: Play and Shuffle. */
  isStretched?: boolean
  isDisabled?: boolean
  /** Waiting on what it started: a spinner in place of the label, the width kept. */
  isLoading?: boolean
}

/** A pill button: Play, Sign in, Cancel, Sign out. */
export function Button({
  label,
  onPress,
  variant = BUTTON_VARIANTS.primary,
  icon,
  size = BUTTON_SIZES.regular,
  isStretched = false,
  isDisabled = false,
  isLoading = false,
}: ButtonProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const ink = colors[VARIANT_INKS[variant]]
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: isLoading }}
      disabled={isDisabled || isLoading}
      onPress={onPress}
      style={pressedStyleOf({
        style: [styles.button, styles[size], styles[variant], isStretched && styles.stretched],
        isDisabled,
      })}
    >
      {/* The label keeps its place under the spinner, so the button never changes width. */}
      <View style={[styles.content, isLoading && UNSEEN]}>
        {icon !== undefined && <WrenIcon color={ink} name={icon} size={SIZE.smallIcon} />}
        <Text numberOfLines={1} style={[styles.label, { color: ink }]}>
          {label}
        </Text>
      </View>
      {isLoading && (
        <View style={styles.spinner}>
          <ActivityIndicator color={ink} />
        </View>
      )}
    </Pressable>
  )
}
