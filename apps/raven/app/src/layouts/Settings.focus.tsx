import type { TabEntry } from '@raven/ui/headless'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { FocusBand } from '@/layouts/FocusBand'
import { HomePlate } from '@/layouts/HomePlate.focus'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import { chosenLabelOf } from '@/layouts/gridKit'
import type {
  SettingsButtonProps,
  SettingsChoiceProps,
  SettingsFactProps,
  SettingsKit,
  SettingsPageProps,
  SettingsTabsProps,
  SettingsToggleProps,
} from '@/layouts/settingsKit'
import { tabA11yOf } from '@/layouts/settingsKit'
import { usePlateStyles } from '@/layouts/tvControls'
import { OPACITIES } from '@/theme/appTheme'
import { CODE_FONT } from '@/theme/fonts'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'
import { type SettingsPartStyles, settingsPartsFor } from '@/layouts/settingsParts'

const usePartStyles = (): SettingsPartStyles => {
  const styles = useStyles()
  return { section: styles.section, heading: styles.heading, note: styles.note, line: styles.line }
}

const { SettingsSection, SettingsLine } = settingsPartsFor({ useStyles: usePartStyles })

/** What a TV toggle says it is set to. */
const TOGGLE_STATES = { on: 'On', off: 'Off' } as const

/**
 * Settings on a TV: one column within the title-safe margin, read from the sofa. Menu or Back
 * leaves it, as the native stack pops it. The remote opens on the chosen tab, once: anything
 * here taking the focus spends the opening focus.
 */
const SettingsPage = ({ title, children }: SettingsPageProps) => {
  useScreenFocusScope()
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.ground}>
      <HomePlate />
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </ScrollView>
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
const SettingsButton = ({ text, isDisabled, onPress, name = text }: SettingsButtonProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <FocusBand>
      <Pressable
        accessibilityLabel={name}
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

/** A fact the remote passes by: laid out as a setting is, with no plate, since nothing opens. */
const SettingsFact = ({ label, value, isCode = false }: SettingsFactProps) => {
  const styles = useStyles()
  return (
    <View accessibilityLabel={`${label}: ${value}`} accessible style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, isCode && styles.code]}>{value}</Text>
    </View>
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

type TabPlateProps<T extends string> = {
  tab: TabEntry<T>
  isChosen: boolean
  onChoose: (value: T) => void
}

/** A tab on a plate, filled in the primary tone while chosen; the remote landing on it chooses it. */
const TabPlate = <T extends string>({ tab, isChosen, onChoose }: TabPlateProps<T>) => {
  const { isOpening, settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  return (
    <Pressable
      {...tabA11yOf({ tab, isChosen })}
      hasTVPreferredFocus={isChosen && isOpening}
      onFocus={() => {
        settle()
        onChoose(tab.value)
      }}
      onPress={() => onChoose(tab.value)}
      style={({ focused }) => [
        plateStyles.plate,
        isChosen && plateStyles.on,
        focused && plateStyles.focused,
      ]}
    >
      <Text style={[plateStyles.label, isChosen && styles.onAccent]}>{tab.label}</Text>
      {tab.count !== undefined && (
        <Text style={[styles.tabCount, isChosen && styles.onAccent]}>{tab.count}</Text>
      )}
    </Pressable>
  )
}

/**
 * The web's tabs as a band of plates under the title. Moving along it chooses as it goes, as the
 * web's arrow keys do, and the band hands the remote back to the chosen tab from below, since it
 * is the one the remote last left there.
 */
const SettingsTabs = <T extends string>({
  label,
  tabs,
  chosen,
  onChoose,
}: SettingsTabsProps<T>) => {
  const styles = useStyles()
  return (
    <FocusBand>
      <View accessibilityLabel={label} accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((tab) => (
          <TabPlate key={tab.value} isChosen={tab.value === chosen} onChoose={onChoose} tab={tab} />
        ))}
      </View>
    </FocusBand>
  )
}

/** Settings on a TV: plates the remote moves down through, and the TV's picker lists. */
export const focusSettings: SettingsKit = {
  SettingsPage,
  SettingsSection,
  SettingsToggle,
  SettingsButton,
  SettingsLine,
  SettingsFact,
  SettingsChoice,
  SettingsTabs,
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
    fact: { flexDirection: 'row', justifyContent: 'space-between', gap: TV_SIZES.space4 },
    factLabel: { flexShrink: 1, flexGrow: 1, color: colours.muted, fontSize: TV_SIZES.text },
    factValue: { flexShrink: 1, color: colours.text, fontSize: TV_SIZES.text },
    code: { fontFamily: CODE_FONT },
    setting: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: TV_SIZES.space4,
      paddingVertical: TV_SIZES.space2,
    },
    button: { alignSelf: 'flex-start' },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: TV_SIZES.space2 },
    tabCount: { color: colours.muted, fontSize: TV_SIZES.text },
    onAccent: { color: colours.onAccent },
    off: { opacity: OPACITIES.disabled },
  }),
)
