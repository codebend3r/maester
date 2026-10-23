import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import {
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { PlateButton, plateStyles } from '@/layouts/tvControls'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** Marks the option chosen now. */
const CHOSEN = '\u2713'

/**
 * A picker the remote drives: a chip that opens a list over the screen, focus on the
 * option chosen now. tvOS has no action sheet (React Native's is built out of it), so this
 * is the TV's on both systems. Menu or Back closes it without choosing.
 */
const Picker = <K extends string>(props: PickerProps<K>) => {
  const { label, options, value, onChoose } = props
  const [isOpen, setOpen] = useState(false)
  const choose = (key: K) => {
    setOpen(false)
    onChoose(key)
  }
  return (
    <>
      <Pressable
        accessibilityLabel={pickerLabelOf(props)}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ focused }) => [plateStyles.plate, styles.chip, focused && plateStyles.focused]}
      >
        <Text style={styles.label}>{label}</Text>
        <Text style={plateStyles.label}>{chosenLabelOf(props)}</Text>
      </Pressable>
      <Modal transparent visible={isOpen} onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.shade} />
          <View accessibilityLabel={label} style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>
              {label}
            </Text>
            <ScrollView contentContainerStyle={styles.options}>
              {options.map((option) => (
                <Pressable
                  key={option.key}
                  accessibilityLabel={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.key === value }}
                  hasTVPreferredFocus={option.key === value}
                  onPress={() => choose(option.key)}
                  style={({ focused }) => [styles.option, focused && styles.focused]}
                >
                  <Text style={[plateStyles.label, option.key === value && styles.chosen]}>
                    {option.key === value ? `${CHOSEN} ${option.label}` : option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

const ToolButton = ({ label, accessibilityLabel, onPress }: ToolButtonProps) => (
  <PlateButton
    label={accessibilityLabel}
    onPress={onPress}
    accessibilityRole="button"
    text={label}
  />
)

/** The toolbar on a TV: chips the remote reaches, each opening a list it moves through. */
export const focusPicker: PickerKit = { Picker, ToolButton }

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', gap: SIZES.space2 },
  focused: { borderColor: COLOURS.text },
  label: { color: COLOURS.muted, fontSize: SIZES.text },
  chosen: { fontWeight: 'bold' },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The web's `--color-scrim` is a translucent black React Native's tokens cannot carry.
  shade: { ...StyleSheet.absoluteFill, backgroundColor: COLOURS.deep, opacity: 0.85 },
  panel: {
    minWidth: SIZES.measure / 2,
    maxHeight: '80%',
    gap: SIZES.space3,
    padding: SIZES.space5,
    borderRadius: SIZES.radius,
    backgroundColor: COLOURS.raised,
  },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  options: { gap: SIZES.space1 },
  option: {
    minHeight: SIZES.controlLarge,
    justifyContent: 'center',
    paddingHorizontal: SIZES.space3,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
})
