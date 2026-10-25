import { StyleSheet } from 'react-native'

import { BODY_FONT } from '@/theme/fonts'
import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'
import { type Palette, SIZES, type Sizes } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/**
 * What both form variants share, at a scale's lengths; each variant scales it further for the
 * distance it is read from. Every control has the web's `--radius-md`, and focus turns its edge
 * to the text colour, which shows on each tone's fill and on none. A form's lines say what a
 * step asks (`note`), what the server said (`notice`) and what went wrong (`error`).
 */
const formStylesFor = ({ sizes, colours }: { sizes: Sizes; colours: Palette }) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    title: { color: colours.text, fontSize: sizes.textXl, fontWeight: 'bold' },
    label: { color: colours.muted, fontSize: sizes.textSm },
    input: {
      color: colours.text,
      fontFamily: BODY_FONT,
      backgroundColor: colours.raised,
      borderColor: colours.line,
      borderWidth: 1,
      borderRadius: sizes.radius,
      minHeight: sizes.fieldHeight,
      paddingHorizontal: sizes.space2,
      fontSize: sizes.text,
    },
    button: {
      alignItems: 'center',
      borderWidth: sizes.focusRing,
      borderRadius: sizes.radius,
      justifyContent: 'center',
      minHeight: sizes.fieldHeight,
      paddingHorizontal: sizes.space2,
    },
    buttonText: { fontSize: sizes.text, fontWeight: 'bold' },
    checkRow: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      borderColor: 'transparent',
      borderRadius: sizes.radius,
      borderWidth: sizes.focusRing,
      flexDirection: 'row',
      gap: sizes.space2,
      padding: sizes.space1,
    },
    checkBox: {
      alignItems: 'center',
      borderColor: colours.text,
      borderRadius: sizes.space1,
      borderWidth: sizes.focusRing,
      height: sizes.text * 1.5,
      justifyContent: 'center',
      width: sizes.text * 1.5,
    },
    checkBoxOn: { backgroundColor: colours.accent, borderColor: colours.accent },
    checkTick: { color: colours.onAccent, fontSize: sizes.text, fontWeight: 'bold' },
    checkText: { color: colours.text, fontSize: sizes.text },
    focused: { borderColor: colours.text },
    disabled: { opacity: 0.5 },
    note: { color: colours.muted, fontSize: sizes.text },
    notice: { color: colours.notice, fontSize: sizes.textLg },
    error: { color: colours.error, fontSize: sizes.text },
  })

export type FormStyles = ReturnType<typeof formStylesFor>

/** The form under the thumb, at the shared scale, in the theme worn now. */
export const useTouchFormStyles: () => FormStyles = themedStyles((colours) =>
  formStylesFor({ sizes: SIZES, colours }),
)

/** The form on a TV, sized to its screen, in the theme worn now. */
export const useTvFormStyles: () => FormStyles = themedStyles((colours) =>
  formStylesFor({ sizes: TV_SIZES, colours }),
)

/** Each tone's fill, edge and label, as the web's `.primary`, `.quiet` and `.ghost` paint them. */
export const useToneStyles = themedStyles(
  (colours) =>
    ({
      [BUTTON_TONES.primary]: StyleSheet.create({
        button: { backgroundColor: colours.accent, borderColor: colours.accent },
        label: { color: colours.onAccent },
      }),
      [BUTTON_TONES.quiet]: StyleSheet.create({
        button: { backgroundColor: colours.quiet, borderColor: colours.quiet },
        label: { color: colours.text },
      }),
      [BUTTON_TONES.ghost]: StyleSheet.create({
        button: { backgroundColor: 'transparent', borderColor: 'transparent' },
        label: { color: colours.text },
      }),
    }) as const satisfies Record<ButtonTone, unknown>,
)
