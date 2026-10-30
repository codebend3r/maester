import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text } from '@/layouts/Text'
import { FocusBand } from '@/layouts/FocusBand'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import { chosenLabelOf } from '@/layouts/gridKit'
import type {
  SettingsButtonProps,
  SettingsChoiceProps,
  SettingsKit,
  SettingsPageProps,
  SettingsSectionProps,
  SettingsToggleProps,
} from '@/layouts/settingsKit'
import { usePlateStyles } from '@/layouts/tvControls'
import { OPACITIES } from '@/theme/appTheme'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** What a TV toggle says it is set to. */
const TOGGLE_STATES = { on: 'On', off: 'Off' } as const

/**
 * Settings on a TV: one column within the title-safe margin, read from the sofa. Menu or Back
 * leaves it, as the native stack pops it. The remote opens on the first button, once: anything
 * here taking the focus spends the opening focus.
 */
const SettingsPage = ({ title, children }: SettingsPageProps) => {
  useScreenFocusScope()
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.ground}>
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

/**
 * A setting the remote turns on and off: the whole row is one plate, pressed to change it, and
 * says where it stands. tvOS has no switch.
 */
const SettingsToggle = ({ label, hint, isOn, onToggle }: SettingsToggleProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn }}
      onFocus={settle}
      onPress={() => onToggle(!isOn)}
      style={({ focused }) => [plateStyles.plate, styles.setting, focused && plateStyles.focused]}
    >
      <View style={styles.words}>
        <Text style={plateStyles.label}>{label}</Text>
        <Text style={styles.line}>{hint}</Text>
      </View>
      <Text style={plateStyles.label}>{isOn ? TOGGLE_STATES.on : TOGGLE_STATES.off}</Text>
    </Pressable>
  )
}

/** A button at the start of its line, in a band as wide as the page. */
const SettingsButton = ({ text, isDisabled, onPress }: SettingsButtonProps) => {
  const { isOpening, settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <FocusBand>
      <Pressable
        accessibilityLabel={text}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        focusable={!isDisabled}
        hasTVPreferredFocus={isOpening && !isDisabled}
        onFocus={settle}
        onPress={onPress}
        style={({ focused }) => [
          plateStyles.plate,
          styles.button,
          focused && plateStyles.focused,
          isDisabled && styles.off,
        ]}
      >
        <Text style={plateStyles.label}>{text}</Text>
      </Pressable>
    </FocusBand>
  )
}

/**
 * A setting picked from a list: one plate laid out as a toggle is, the label at the start and
 * what is chosen now at the end, that opens the TV's picker list.
 */
const SettingsChoice = <K extends string>(props: SettingsChoiceProps<K>) => {
  const { settle } = useOpeningFocus()
  const { open, label, list } = usePickerList(props)
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onFocus={settle}
        onPress={open}
        style={({ focused }) => [plateStyles.plate, styles.setting, focused && plateStyles.focused]}
      >
        <Text style={[plateStyles.label, styles.choiceLabel]}>{props.label}</Text>
        <Text style={plateStyles.label}>{chosenLabelOf(props)}</Text>
      </Pressable>
      <PickerList {...list} />
    </>
  )
}

/** Settings on a TV: plates the remote moves down through, and the TV's picker lists. */
export const focusSettings: SettingsKit = {
  SettingsPage,
  SettingsSection,
  SettingsToggle,
  SettingsButton,
  SettingsChoice,
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: {
      gap: TV_SIZES.space5,
      paddingVertical: TV_SIZES.space6,
      paddingHorizontal: TV_GUTTER,
    },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    section: { gap: TV_SIZES.space3 },
    heading: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    note: { color: colours.muted, fontSize: TV_SIZES.text },
    words: { flexShrink: 1, flexGrow: 1, gap: TV_SIZES.space0 },
    choiceLabel: { flexShrink: 1, flexGrow: 1 },
    line: { color: colours.muted, fontSize: TV_SIZES.text },
    setting: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: TV_SIZES.space4,
      paddingVertical: TV_SIZES.space2,
    },
    button: { alignSelf: 'flex-start' },
    off: { opacity: OPACITIES.disabled },
  }),
)
