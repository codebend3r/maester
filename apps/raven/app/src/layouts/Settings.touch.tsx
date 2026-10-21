import { type ComponentRef, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { openPickerSheet } from '@/layouts/Picker.touch'
import { TouchBack } from '@/layouts/TouchBack'
import { chosenLabelOf, pickerLabelOf } from '@/layouts/gridKit'
import type {
  ServerRowProps,
  SettingsButtonProps,
  SettingsChoiceProps,
  SettingsKit,
  SettingsPageProps,
  SettingsSectionProps,
  SettingsSheetProps,
  SettingsToggleProps,
} from '@/layouts/settingsKit'
import { SIZES } from '@/theme/appTheme'
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
      <TouchBack onPress={onBack} />
      <Text accessibilityRole="header" style={styles.title}>
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
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
      {note !== null && <Text style={styles.note}>{note}</Text>}
    </View>
  )
}

/** A server under the thumb: its name and address, its mark when in use, and its buttons. */
const ServerRow = ({ name, line, badge, actions }: ServerRowProps) => {
  const styles = useStyles()
  return (
    <View style={styles.row}>
      <View style={styles.words}>
        <View style={styles.nameRow}>
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {badge !== null && <Text style={styles.badge}>{badge}</Text>}
        </View>
        <Text numberOfLines={1} style={styles.line}>
          {line}
        </Text>
      </View>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityLabel={action.label}
            accessibilityRole="button"
            hitSlop={SIZES.space1}
            onPress={action.onPress}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          >
            <Text style={styles.chipLabel}>{action.text}</Text>
          </Pressable>
        ))}
      </View>
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

/**
 * A step drawn in the page's place, which its own Cancel leaves; the stack's swipe back leaves
 * Settings with it.
 */
const SettingsSheet = ({ children }: SettingsSheetProps) => children

/** Settings on a phone or tablet: one page under the thumb, the system's switches and sheets. */
export const touchSettings: SettingsKit = {
  SettingsPage,
  SettingsSection,
  ServerRow,
  SettingsToggle,
  SettingsButton,
  SettingsChoice,
  SettingsSheet,
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { gap: SIZES.space4, width: '100%', maxWidth: SIZES.measure, alignSelf: 'center' },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
    section: { gap: SIZES.space2 },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
    note: { color: colours.muted, fontSize: SIZES.textSm },
    row: {
      gap: SIZES.space2,
      padding: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
    },
    words: { flexShrink: 1, flexGrow: 1, gap: SIZES.space0 },
    choiceLabel: { flexShrink: 1, flexGrow: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    name: { flexShrink: 1, color: colours.text, fontSize: SIZES.text, fontWeight: '600' },
    badge: {
      paddingHorizontal: SIZES.space1,
      borderRadius: SIZES.radius,
      overflow: 'hidden',
      color: colours.onAccent,
      backgroundColor: colours.accent,
      fontSize: SIZES.textXs,
      fontWeight: 'bold',
    },
    line: { color: colours.muted, fontSize: SIZES.textSm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space2 },
    chip: {
      minHeight: SIZES.fieldHeight,
      justifyContent: 'center',
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: colours.quiet,
    },
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
    pressed: { opacity: 0.6 },
    off: { opacity: 0.5 },
  }),
)
