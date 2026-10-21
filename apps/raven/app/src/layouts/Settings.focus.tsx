import { type ComponentRef, useEffect, useRef } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { FocusBand } from '@/layouts/FocusBand'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
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
import { requestTVFocus } from '@/layouts/tvFocus'
import { PlateButton, usePlateStyles } from '@/layouts/tvControls'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** What a TV toggle says it is set to. */
const TOGGLE_STATES = { on: 'On', off: 'Off' } as const

/**
 * Settings on a TV: one column within the title-safe margin, read from the sofa. Menu or Back
 * leaves it, as the native stack pops it. The remote opens on the first server's first button,
 * once: anything here taking the focus spends the opening focus. A rename draws its form in a
 * sheet in the page's place, so coming back from it is an opening too, on that server's Rename.
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
 * A server the remote reaches: its name, address and mark, then its buttons. The whole row is a
 * band as wide as the page, so Down or Up into it lands on its first button or the one last left
 * there, though the buttons sit at the row's far end. A button pressed that goes from the row
 * (Sign out, once the account has) hands the remote to the row's first button, since the
 * platform would move it elsewhere on the page, or, on Android TV, perhaps to nothing.
 */
const ServerRow = ({ name, line, badge, actions, openingAction }: ServerRowProps) => {
  const { isOpening, settle } = useOpeningFocus()
  const styles = useStyles()
  const first = useRef<ComponentRef<typeof Pressable>>(null)
  // The button last pressed, until the remote moves to another of the row's.
  const pressed = useRef<string | null>(null)
  useEffect(() => {
    const key = pressed.current
    if (key === null || actions.some((action) => action.key === key)) return
    pressed.current = null
    requestTVFocus(first.current)
  }, [actions])
  return (
    <FocusBand>
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
          {actions.map((action, index) => (
            <PlateButton
              key={action.key}
              ref={index === 0 ? first : undefined}
              accessibilityRole="button"
              isPreferred={isOpening && action.key === openingAction}
              label={action.label}
              onFocused={() => {
                pressed.current = null
                settle()
              }}
              onPress={() => {
                pressed.current = action.key
                action.onPress()
              }}
              text={action.text}
            />
          ))}
        </View>
      </View>
    </FocusBand>
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

/**
 * A button at the start of its line, in a band as wide as the page, so Down from a server's
 * buttons at the row's far end lands on it rather than passing it by.
 */
const SettingsButton = ({ text, isDisabled, onPress }: SettingsButtonProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <FocusBand>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        focusable={!isDisabled}
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
  const { open, list } = usePickerList(props)
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <>
      <Pressable
        accessibilityLabel={pickerLabelOf(props)}
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

/**
 * A step over Settings in a sheet of its own, so Menu or Back closes the step rather than
 * popping Settings off the native stack.
 */
const SettingsSheet = ({ onClose, children }: SettingsSheetProps) => (
  <Modal visible onRequestClose={onClose}>
    {children}
  </Modal>
)

/** Settings on a TV: plates the remote moves down through, and the TV's picker lists. */
export const focusSettings: SettingsKit = {
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
    page: {
      gap: TV_SIZES.space5,
      paddingVertical: TV_SIZES.space6,
      paddingHorizontal: TV_SIZES.space8,
    },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    section: { gap: TV_SIZES.space3 },
    heading: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    note: { color: colours.muted, fontSize: TV_SIZES.text },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space4,
      padding: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.raised,
    },
    words: { flexShrink: 1, flexGrow: 1, gap: TV_SIZES.space0 },
    choiceLabel: { flexShrink: 1, flexGrow: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space2 },
    name: { flexShrink: 1, color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    badge: {
      paddingHorizontal: TV_SIZES.space2,
      borderRadius: TV_SIZES.radius,
      overflow: 'hidden',
      color: colours.onAccent,
      backgroundColor: colours.accent,
      fontSize: TV_SIZES.text,
      fontWeight: 'bold',
    },
    line: { color: colours.muted, fontSize: TV_SIZES.text },
    actions: { flexDirection: 'row', gap: TV_SIZES.space2 },
    setting: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: TV_SIZES.space4,
      paddingVertical: TV_SIZES.space2,
    },
    button: { alignSelf: 'flex-start' },
    off: { opacity: 0.5 },
  }),
)
