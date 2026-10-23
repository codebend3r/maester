import { type AccessibilityRole, Pressable, StyleSheet, Text } from 'react-native'

import { COLOURS, SIZES } from '@/theme/appTheme'

/** What a TV control does on focus unless told more: nothing beyond its own ring or growth. */
export const NOTHING_ON_FOCUS = (): void => undefined

/** The round end of tvOS's focused field plate: half the field's height. */
const PLATE_END = SIZES.controlLarge / 2

/**
 * A TV text field's frame and the input inside it. tvOS draws a focused text field as its own
 * raised plate with round ends. The input runs past the frame by those ends, which the frame
 * clips, so what shows has the frame's corners, the radius every other control has.
 */
export const tvFieldStyles = StyleSheet.create({
  frame: { minHeight: SIZES.controlLarge, overflow: 'hidden', paddingHorizontal: 0 },
  input: {
    color: COLOURS.text,
    fontSize: SIZES.textLg,
    minHeight: SIZES.controlLarge,
    marginHorizontal: -PLATE_END,
    paddingHorizontal: PLATE_END + SIZES.space2,
  },
})

/**
 * A TV control's plate: the quiet fill, at least as wide as it is tall, whose edge turns to
 * the text colour while it has the focus.
 */
export const plateStyles = StyleSheet.create({
  plate: {
    minWidth: SIZES.controlLarge,
    minHeight: SIZES.controlLarge,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SIZES.space3,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: COLOURS.quiet,
    backgroundColor: COLOURS.quiet,
  },
  focused: { borderColor: COLOURS.text },
  label: { color: COLOURS.text, fontSize: SIZES.textLg, fontWeight: '600' },
})

/** A plain button on a plate, the remote's to press: `text` is what it shows, `label` is said. */
export const PlateButton = ({
  text,
  label,
  accessibilityRole,
  onPress,
}: {
  text: string
  label: string
  accessibilityRole: AccessibilityRole
  onPress: () => void
}) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole={accessibilityRole}
    onPress={onPress}
    style={({ focused }) => [plateStyles.plate, focused && plateStyles.focused]}
  >
    <Text style={plateStyles.label}>{text}</Text>
  </Pressable>
)
