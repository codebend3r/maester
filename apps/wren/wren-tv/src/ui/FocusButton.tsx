import { Text } from 'react-native'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { Focusable, type FocusableProps } from '@/ui/Focusable'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

/** How loud a button is: the screen's one main action, or a plain one. */
export const BUTTON_TONES = { primary: 'primary', secondary: 'secondary' } as const

type ButtonTone = (typeof BUTTON_TONES)[keyof typeof BUTTON_TONES]

type ToneLook = { ground: string; ink: string }

/** Each tone's ground and ink at rest; lit by the remote or picked, every tone is text on bg. */
const toneLooksOf = ({ colors }: WrenTheme) =>
  ({
    [BUTTON_TONES.primary]: { ground: colors.accent, ink: colors.accentInk },
    [BUTTON_TONES.secondary]: { ground: colors.surface2, ink: colors.text },
  }) as const satisfies Record<ButtonTone, ToneLook>

const useStyles = themedStyles(({ colors }) => ({
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    gap: SPACE.s2,
    justifyContent: 'center',
    minHeight: SIZE.button,
    paddingHorizontal: SPACE.s4,
  },
  lit: { backgroundColor: colors.text },
  text: TYPE.button,
}))

type FocusButtonProps = Omit<FocusableProps, 'children' | 'style' | 'focusedStyle'> & {
  /** Its words, shown; the label is what a screen reader says. */
  text?: string
  icon?: WrenIconName
  tone?: ButtonTone
}

/**
 * A pill of words, an icon or both. With the remote on it, or picked, it turns to the theme's
 * text colour with the ground's ink, the loudest thing on the screen, so the focus reads at once.
 */
export function FocusButton({
  text,
  icon,
  tone = BUTTON_TONES.secondary,
  ...props
}: FocusButtonProps) {
  const styles = useStyles()
  const theme = useWrenTheme()
  const look = toneLooksOf(theme)[tone]
  const isPicked = !!props.isSelected
  return (
    <Focusable
      {...props}
      focusedStyle={styles.lit}
      style={[styles.button, { backgroundColor: look.ground }, isPicked && styles.lit]}
    >
      {({ isFocused }) => {
        const ink = isFocused || isPicked ? theme.colors.bg : look.ink
        return (
          <>
            {icon !== undefined && <WrenIcon color={ink} name={icon} />}
            {text !== undefined && <Text style={[styles.text, { color: ink }]}>{text}</Text>}
          </>
        )
      }}
    </Focusable>
  )
}
