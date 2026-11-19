import { type ComponentRef, useRef } from 'react'
import type { View } from 'react-native'

import { Chip } from '@/layouts/Chip.touch'
import {
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { type SheetAnchor, showChoice } from '@/layouts/touchSheets'

type OpenPickerSheetProps<K extends string> = Pick<
  PickerProps<K>,
  'label' | 'options' | 'onChoose' | 'isOverPicture'
> & {
  anchor: SheetAnchor
  /** The option drawn in red, as the sheet marks what cannot be undone. */
  destructiveKey?: K
  /** A line under the title: why an action is not offered. */
  message?: string | null
}

/**
 * Opens this device's sheet for a picker (the system's on an iPhone or iPad, as a popover
 * pointing at `anchor`'s view on an iPad; raven's own on Android), light or dark as the theme's
 * ground is, and dark over the video.
 */
export const openPickerSheet = <K extends string>({
  label,
  options,
  onChoose,
  isOverPicture = false,
  anchor,
  destructiveKey,
  message = null,
}: OpenPickerSheetProps<K>) =>
  showChoice({
    title: label,
    message,
    options: options.map((option) => ({
      key: option.key,
      label: option.label,
      isDestructive: option.key === destructiveKey,
      onPress: () => onChoose(option.key),
    })),
    isOverPicture,
    anchor,
  })

/**
 * A picker under the thumb: a chip that opens this device's sheet, on an iPad as a popover
 * pointing at the chip. Over the video the chip is the player's dark glass and the sheet is
 * dark, whatever the theme. Its word and its value show unless `isIconOnly`; the spoken label
 * says both either way.
 */
const Picker = <K extends string>(props: PickerProps<K>) => {
  const chip = useRef<ComponentRef<typeof View>>(null)
  const isIconOnly = !!props.isIconOnly
  return (
    <Chip
      ref={chip}
      icon={props.icon}
      isOverPicture={props.isOverPicture}
      label={pickerLabelOf(props)}
      lead={isIconOnly ? null : props.label}
      onPress={() => openPickerSheet({ ...props, anchor: chip })}
      text={isIconOnly ? null : chosenLabelOf(props)}
    />
  )
}

/** A toolbar button under the thumb is its icon alone; the spoken label says what it does. */
const ToolButton = ({ icon, accessibilityLabel, onPress, isOverPicture }: ToolButtonProps) => (
  <Chip
    icon={icon}
    isOverPicture={isOverPicture}
    label={accessibilityLabel}
    onPress={onPress}
    text={null}
  />
)

/** The toolbar on a phone or tablet: chips that open this device's sheet. */
export const touchPicker: PickerKit = { Picker, ToolButton }
