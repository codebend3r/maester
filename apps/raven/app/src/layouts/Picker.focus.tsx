import { useState } from 'react'
import { Icon } from '@raven/native'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

import {
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { PICKER_LIST_COPY } from '@/layouts/copy'
import { Text } from '@/layouts/Text'
import { TvSheet, useSheetStyles } from '@/layouts/TvSheet.focus'
import { PlateButton, usePlateStyles } from '@/layouts/tvControls'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** What a picker does as its list opens or closes unless told more: nothing. */
const NOTHING_ON_OPEN = (): void => undefined

type PickerListProps<K extends string> = Pick<
  PickerProps<K>,
  'label' | 'options' | 'value' | 'onChoose' | 'isOverPicture'
> & { isOpen: boolean; onClose: () => void }

/**
 * The list a TV picker opens over the screen, a sheet with the focus on the option chosen now.
 * Menu or Back closes it without choosing; over the video it is the player's dark glass.
 */
export const PickerList = <K extends string>({
  label,
  options,
  value,
  onChoose,
  isOverPicture,
  isOpen,
  onClose,
}: PickerListProps<K>) => {
  const styles = useStyles({ isOverPicture })
  const sheetStyles = useSheetStyles({ isOverPicture })
  const plateStyles = usePlateStyles({ isOverPicture })
  return (
    isOpen && (
      <TvSheet isOverPicture={isOverPicture} onClose={onClose} title={label}>
        <ScrollView contentContainerStyle={sheetStyles.options}>
          {options.map((option) => (
            <Pressable
              key={option.key}
              accessibilityLabel={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected: option.key === value }}
              hasTVPreferredFocus={option.key === value}
              onPress={() => onChoose(option.key)}
              style={({ focused }) => [sheetStyles.option, focused && sheetStyles.focused]}
            >
              <Text style={[plateStyles.label, option.key === value && styles.chosen]}>
                {option.key === value ? PICKER_LIST_COPY.chosen(option.label) : option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </TvSheet>
    )
  )
}

type UsePickerListProps<K extends string> = Omit<PickerProps<K>, 'icon'>

/**
 * What opens a TV picker's list, what the control that opens it is called aloud (`pickerLabelOf`),
 * and the props that draw the list: choosing closes the list, and `onOpenChange` hears each open
 * and close.
 */
export const usePickerList = <K extends string>({
  label,
  options,
  value,
  onChoose,
  onOpenChange = NOTHING_ON_OPEN,
  isOverPicture,
}: UsePickerListProps<K>): { open: () => void; label: string; list: PickerListProps<K> } => {
  const [isOpen, setIsOpen] = useState(false)
  const setOpen = (isOpening: boolean) => {
    setIsOpen(isOpening)
    onOpenChange(isOpening)
  }
  return {
    open: () => setOpen(true),
    label: pickerLabelOf({ label, options, value }),
    list: {
      label,
      options,
      value,
      isOverPicture,
      isOpen,
      onClose: () => setOpen(false),
      onChoose: (key) => {
        setOpen(false)
        onChoose(key)
      },
    },
  }
}

/**
 * A picker the remote drives: a chip that opens its list over the screen, both the player's dark
 * glass over the video.
 */
const Picker = <K extends string>(props: PickerProps<K>) => {
  const { open, label, list } = usePickerList(props)
  const ground = { isOverPicture: props.isOverPicture }
  const styles = useStyles(ground)
  const plateStyles = usePlateStyles(ground)
  const colour = useTheme((theme) => (props.isOverPicture ? theme.overPicture : theme.palette).text)
  return (
    <>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={open}
        style={({ focused }) => [plateStyles.plate, focused && plateStyles.focused]}
      >
        {({ focused }) => (
          <>
            <Icon colour={colour} isFocused={focused} name={props.icon} size={TV_SIZES.textLg} />
            <Text style={styles.label}>{props.label}</Text>
            <Text style={plateStyles.label}>{chosenLabelOf(props)}</Text>
          </>
        )}
      </Pressable>
      <PickerList {...list} />
    </>
  )
}

const ToolButton = ({
  label,
  icon,
  accessibilityLabel,
  onPress,
  isOverPicture,
}: ToolButtonProps) => (
  <PlateButton
    label={accessibilityLabel}
    onPress={onPress}
    accessibilityRole="button"
    isOverPicture={isOverPicture}
    text={label}
    icon={icon}
  />
)

/** The toolbar on a TV: chips the remote reaches, each opening a list it moves through. */
export const focusPicker: PickerKit = { Picker, ToolButton }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    label: { color: colours.muted, fontSize: TV_SIZES.text },
    chosen: { fontWeight: 'bold' },
  }),
)
