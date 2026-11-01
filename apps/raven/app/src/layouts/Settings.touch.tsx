import { type ComponentRef, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { openPickerSheet } from '@/layouts/Picker.touch'
import { TouchNav } from '@/layouts/TouchNav'
import { chosenLabelOf, pickerLabelOf } from '@/layouts/gridKit'
import type {
  SettingsButtonProps,
  SettingsChoiceProps,
  SettingsKit,
  SettingsPageProps,
  SettingsSectionProps,
  SettingsToggleProps,
} from '@/layouts/settingsKit'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'

const SettingsPage = ({ title, onBack, children }: SettingsPageProps) => {
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        {
          paddingTop: insets.top + SIZES.space2,
          paddingBottom: insets.bottom + SIZES.space5,
          paddingLeft: insets.left + SIZES.space3,
          paddingRight: insets.right + SIZES.space3,
        },
      ]}
      style={styles.ground}
    >
      <TouchNav onBack={onBack} />
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </ScrollView>
  )
}

const SettingsSection = ({ title, note, children }: SettingsSectionProps) => {
  const styles = useStyles()
  return (
    <View style={styles.section}>
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
      {note !== null && <Text style={styles.note}>{note}</Text>}
    </View>
  )
}

/** A setting turned on and off with the system's own switch. */
const SettingsToggle = ({ label, hint, isOn, onToggle }: SettingsToggleProps) => {
  const styles = useStyles()
  const { quiet, accent } = useTheme((theme) => theme.palette)
  return (
    <View style={styles.toggle}>
      <View style={styles.words}>
        <Text style={styles.name}>{label}</Text>
        <Text style={styles.line}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityRole="switch"
        onValueChange={onToggle}
        ios_backgroundColor={quiet}
        trackColor={{ false: quiet, true: accent }}
        value={isOn}
      />
    </View>
  )
}

const SettingsButton = ({ text, isDisabled, onPress }: SettingsButtonProps) => {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, isDisabled && styles.off]}
    >
      <Text style={styles.chipLabel}>{text}</Text>
    </Pressable>
  )
}

/**
 * A setting picked from the system's action sheet: a row laid out as a toggle is, the label at
 * the start and what is chosen now at the end, on an iPad a popover pointing at the row.
 */
const SettingsChoice = <K extends string>(props: SettingsChoiceProps<K>) => {
  const row = useRef<ComponentRef<typeof View>>(null)
  const styles = useStyles()
  return (
    <Pressable
      ref={row}
      accessibilityLabel={pickerLabelOf(props)}
      accessibilityRole="button"
      onPress={() => openPickerSheet({ ...props, anchor: row })}
      style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
    >
      <Text style={[styles.name, styles.choiceLabel]}>{props.label}</Text>
      <Text style={styles.chipLabel}>{chosenLabelOf(props)}</Text>
    </Pressable>
  )
}

/** Settings on a phone or tablet: one page under the thumb, the system's switches and sheets. */
export const touchSettings: SettingsKit = {
  SettingsPage,
  SettingsSection,
  SettingsToggle,
  SettingsButton,
  SettingsChoice,
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { gap: SIZES.space4, width: '100%', maxWidth: SIZES.measure, alignSelf: 'center' },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
    section: { gap: SIZES.space2 },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
    note: { color: colours.muted, fontSize: SIZES.textSm },
    words: { flexShrink: 1, flexGrow: 1, gap: SIZES.space0 },
    choiceLabel: { flexShrink: 1, flexGrow: 1 },
    name: { flexShrink: 1, color: colours.text, fontSize: SIZES.text, fontWeight: '600' },
    line: { color: colours.muted, fontSize: SIZES.textSm },
    chipLabel: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space3,
      padding: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
    },
    button: {
      alignSelf: 'flex-start',
      minHeight: SIZES.fieldHeight,
      justifyContent: 'center',
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: colours.quiet,
    },
    pressed: { opacity: OPACITIES.pressed },
    off: { opacity: OPACITIES.disabled },
  }),
)
