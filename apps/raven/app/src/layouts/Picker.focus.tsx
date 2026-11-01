import { useState } from 'react'
import { Icon } from '@raven/native'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import {
  type PickerKit,
  type PickerProps,
  type ToolButtonProps,
  chosenLabelOf,
  pickerLabelOf,
} from '@/layouts/gridKit'
import { PICKER_LIST_COPY } from '@/layouts/copy'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
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
 * The list a TV picker opens over the screen, focus on the option chosen now. tvOS has no action
 * sheet (React Native's is built out of it), so this is the TV's on both systems. Menu or Back
 * closes it without choosing. Over the video it is the player's dark glass in every theme.
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
  const plateStyles = usePlateStyles({ isOverPicture })
  return (
    <Modal transparent visible={isOpen} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.shade} />
        <View accessibilityLabel={label} style={styles.panel}>
          <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
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
                onPress={() => onChoose(option.key)}
                style={({ focused }) => [styles.option, focused && styles.focused]}
              >
                <Text style={[plateStyles.label, option.key === value && styles.chosen]}>
                  {option.key === value ? PICKER_LIST_COPY.chosen(option.label) : option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
    focused: { borderColor: colours.text },
    label: { color: colours.muted, fontSize: TV_SIZES.text },
    chosen: { fontWeight: 'bold' },
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // The web's `--color-scrim` is a translucent black React Native's tokens cannot carry.
    shade: { ...StyleSheet.absoluteFill, backgroundColor: colours.deep, opacity: 0.85 },
    panel: {
      minWidth: TV_SIZES.measure / 2,
      maxHeight: '80%',
      gap: TV_SIZES.space3,
      padding: TV_SIZES.space5,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.raised,
    },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    options: { gap: TV_SIZES.space1 },
    option: {
      minHeight: TV_SIZES.controlLarge,
      justifyContent: 'center',
      paddingHorizontal: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
  }),
)
