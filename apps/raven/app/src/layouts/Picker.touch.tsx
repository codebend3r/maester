import { THEME_TONES } from '@raven/core'
import { type ComponentRef, type RefObject, useRef } from 'react'
import { ActionSheetIOS, Pressable, StyleSheet, Text, View, findNodeHandle } from 'react-native'

import {
  CANCEL,
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { SIZES } from '@/theme/appTheme'
import { themeNow, themedStyles } from '@/theme/useTheme'

/**
 * Opens the system's action sheet for a picker, on an iPad as a popover pointing at `anchor`'s
 * view when it has one, light or dark as the theme's ground is, and dark over the video.
 */
export const openPickerSheet = <K extends string>({
  label,
  options,
  onChoose,
  isOverPicture = false,
  anchor,
}: Pick<PickerProps<K>, 'label' | 'options' | 'onChoose' | 'isOverPicture'> & {
  anchor: RefObject<ComponentRef<typeof View> | null>
}) => {
  const node = anchor.current === null ? null : findNodeHandle(anchor.current)
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: label,
      options: [...options.map((option) => option.label), CANCEL],
      cancelButtonIndex: options.length,
      ...(node === null ? {} : { anchor: node }),
      userInterfaceStyle: isOverPicture ? THEME_TONES.dark : themeNow().tone,
    },
    (index) => {
      const chosen = options[index]
      if (chosen !== undefined) onChoose(chosen.key)
    },
  )
}

/**
 * A picker under the thumb: a chip that opens the system's action sheet, on an iPad as a
 * popover pointing at the chip. Only iPhones and iPads use the touch layout. Over the video the
 * chip is the player's dark glass and the sheet is dark, whatever the theme.
 */
const Picker = <K extends string>(props: PickerProps<K>) => {
  const chip = useRef<ComponentRef<typeof View>>(null)
  const styles = useStyles({ isOverPicture: props.isOverPicture })
  return (
    <Pressable
      ref={chip}
      accessibilityLabel={pickerLabelOf(props)}
      accessibilityRole="button"
      onPress={() => openPickerSheet({ ...props, anchor: chip })}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{props.label}</Text>
      <Text style={styles.value}>{chosenLabelOf(props)}</Text>
    </Pressable>
  )
}

const ToolButton = ({ label, accessibilityLabel, onPress, isOverPicture }: ToolButtonProps) => {
  const styles = useStyles({ isOverPicture })
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text style={styles.value}>{label}</Text>
    </Pressable>
  )
}

/** The toolbar on a phone or tablet: chips that open the system's sheet. */
export const touchPicker: PickerKit = { Picker, ToolButton }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space1,
      minHeight: SIZES.fieldHeight,
      paddingHorizontal: SIZES.space2,
      borderRadius: SIZES.radius,
      backgroundColor: colours.quiet,
    },
    pressed: { opacity: 0.6 },
    label: { color: colours.muted, fontSize: SIZES.textSm },
    value: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
  }),
)
