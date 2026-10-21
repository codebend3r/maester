import { StyleSheet } from 'react-native'

import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'
import { COLOURS, SIZES, type Sizes } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'

/**
 * What both form variants share, at a scale's lengths; each variant scales it further for the
 * distance it is read from. Every control has the web's `--radius-md`, and focus turns its edge
 * to the text colour, which shows on each tone's fill and on none. A form's lines say what a
 * step asks (`note`), what the server said (`notice`) and what went wrong (`error`).
 */
const formStylesFor = ({ sizes }: { sizes: Sizes }) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: COLOURS.ground },
    title: { color: COLOURS.text, fontSize: sizes.textXl, fontWeight: 'bold' },
    label: { color: COLOURS.muted, fontSize: sizes.textSm },
    input: {
      color: COLOURS.text,
      backgroundColor: COLOURS.raised,
      borderColor: COLOURS.line,
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
    focused: { borderColor: COLOURS.text },
    disabled: { opacity: 0.5 },
    note: { color: COLOURS.muted, fontSize: sizes.text },
    notice: { color: COLOURS.notice, fontSize: sizes.textLg },
    error: { color: COLOURS.error, fontSize: sizes.text },
  })

export type FormStyles = ReturnType<typeof formStylesFor>

/** The form under the thumb, at the shared scale. */
export const touchFormStyles: FormStyles = formStylesFor({ sizes: SIZES })

/** The form on a TV, sized to its screen. */
export const tvFormStyles: FormStyles = formStylesFor({ sizes: TV_SIZES })

/** Each tone's fill, edge and label, as the web's `.primary`, `.quiet` and `.ghost` paint them. */
export const toneStyles = {
  [BUTTON_TONES.primary]: StyleSheet.create({
    button: { backgroundColor: COLOURS.accent, borderColor: COLOURS.accent },
    label: { color: COLOURS.onAccent },
  }),
  [BUTTON_TONES.quiet]: StyleSheet.create({
    button: { backgroundColor: COLOURS.quiet, borderColor: COLOURS.quiet },
    label: { color: COLOURS.text },
  }),
  [BUTTON_TONES.ghost]: StyleSheet.create({
    button: { backgroundColor: 'transparent', borderColor: 'transparent' },
    label: { color: COLOURS.text },
  }),
} as const satisfies Record<ButtonTone, unknown>
