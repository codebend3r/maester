import { StyleSheet } from 'react-native'

import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'
import { COLOURS, SIZES } from '@/theme/appTheme'

/**
 * What both form variants share; each scales it for the distance it is read from. Every
 * control has the web's `--radius-md`, and focus turns its edge to the text colour, which
 * shows on each tone's fill and on none.
 */
export const formStyles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  label: { color: COLOURS.muted, fontSize: SIZES.textSm },
  input: {
    color: COLOURS.text,
    backgroundColor: COLOURS.raised,
    borderColor: COLOURS.line,
    borderWidth: 1,
    borderRadius: SIZES.radius,
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space2,
    fontSize: SIZES.text,
  },
  button: {
    alignItems: 'center',
    borderWidth: SIZES.focusRing,
    borderRadius: SIZES.radius,
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space2,
  },
  buttonText: { fontSize: SIZES.text, fontWeight: 'bold' },
  focused: { borderColor: COLOURS.text },
  disabled: { opacity: 0.5 },
})

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
