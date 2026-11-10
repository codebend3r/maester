import { THEME_TONES } from '@raven/core'
import { type ComponentRef, type RefObject, useRef } from 'react'
import { ActionSheetIOS, View, findNodeHandle } from 'react-native'

import { Chip } from '@/layouts/Chip.touch'
import {
  CANCEL,
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { themeNow } from '@/theme/useTheme'

type OpenPickerSheetProps<K extends string> = Pick<
  PickerProps<K>,
  'label' | 'options' | 'onChoose' | 'isOverPicture'
> & {
  anchor: RefObject<ComponentRef<typeof View> | null>
  /** The option drawn in red, as the sheet marks what cannot be undone. */
  destructiveKey?: K
  /** A line under the title: why an action is not offered. */
  message?: string | null
}

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
  destructiveKey,
  message = null,
}: OpenPickerSheetProps<K>) => {
  const node = anchor.current === null ? null : findNodeHandle(anchor.current)
  const destructiveIndex = options.findIndex((option) => option.key === destructiveKey)
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: label,
      ...(message === null ? {} : { message }),
      options: [...options.map((option) => option.label), CANCEL],
      cancelButtonIndex: options.length,
      ...(destructiveIndex === -1 ? {} : { destructiveButtonIndex: destructiveIndex }),
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
 * chip is the player's dark glass and the sheet is dark, whatever the theme. Its word and its
 * value show unless `isIconOnly`; the spoken label says both either way.
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

/** The toolbar on a phone or tablet: chips that open the system's sheet. */
export const touchPicker: PickerKit = { Picker, ToolButton }
