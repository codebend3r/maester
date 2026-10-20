import { type ComponentRef, useRef } from 'react'
import { ActionSheetIOS, Pressable, StyleSheet, Text, View, findNodeHandle } from 'react-native'

import {
  CANCEL,
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { COLOURS, SIZES } from '@/theme/appTheme'

/**
 * A picker under the thumb: a chip that opens the system's action sheet, on an iPad as a
 * popover pointing at the chip. Only iPhones and iPads use the touch layout.
 */
const Picker = <K extends string>(props: PickerProps<K>) => {
  const { label, options, onChoose } = props
  const chip = useRef<ComponentRef<typeof View>>(null)
  const open = () => {
    const anchor = chip.current === null ? null : findNodeHandle(chip.current)
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: label,
        options: [...options.map((option) => option.label), CANCEL],
        cancelButtonIndex: options.length,
        ...(anchor === null ? {} : { anchor }),
        userInterfaceStyle: 'dark',
      },
      (index) => {
        const chosen = options[index]
        if (chosen !== undefined) onChoose(chosen.key)
      },
    )
  }
  return (
    <Pressable
      ref={chip}
      accessibilityLabel={pickerLabelOf(props)}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{chosenLabelOf(props)}</Text>
    </Pressable>
  )
}

const ToolButton = ({ label, accessibilityLabel, onPress }: ToolButtonProps) => (
  <Pressable
    accessibilityLabel={accessibilityLabel}
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
  >
    <Text style={styles.value}>{label}</Text>
  </Pressable>
)

/** The toolbar on a phone or tablet: chips that open the system's sheet. */
export const touchPicker: PickerKit = { Picker, ToolButton }

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.space1,
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space2,
    borderRadius: SIZES.radius,
    backgroundColor: COLOURS.quiet,
  },
  pressed: { opacity: 0.6 },
  label: { color: COLOURS.muted, fontSize: SIZES.textSm },
  value: { color: COLOURS.text, fontSize: SIZES.textSm, fontWeight: '600' },
})
