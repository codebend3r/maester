import type { TabEntry } from '@raven/ui/headless'
import { type ComponentRef, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HomeScrollView } from '@/layouts/ScrollHome.touch'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { openPickerSheet } from '@/layouts/Picker.touch'
import { TouchNav } from '@/layouts/TouchNav'
import { isTabletLayout } from '@/layouts/tabletKit'
import { chosenLabelOf, pickerLabelOf } from '@/layouts/gridKit'
import type {
  SettingsButtonProps,
  SettingsChoiceProps,
  SettingsKit,
  SettingsFactProps,
  SettingsPageProps,
  SettingsTabsProps,
  SettingsToggleProps,
} from '@/layouts/settingsKit'
import { tabA11yOf } from '@/layouts/settingsKit'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { CODE_FONT } from '@/theme/fonts'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { type SettingsPartStyles, settingsPartsFor } from '@/layouts/settingsParts'

const usePartStyles = (): SettingsPartStyles => {
  const styles = useStyles()
  return { section: styles.section, heading: styles.heading, note: styles.note, line: styles.line }
}

const { SettingsSection, SettingsLine } = settingsPartsFor({ useStyles: usePartStyles })

const SettingsPage = ({ title, onBack, children }: SettingsPageProps) => {
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  return (
    <HomeScrollView
      contentContainerStyle={[
        styles.page,
        // An iPad's Settings runs the screen's width; a phone's keeps the reading measure.
        !isTabletLayout() && styles.measured,
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
    </HomeScrollView>
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

const SettingsButton = ({ text, isDisabled, onPress, name = text }: SettingsButtonProps) => {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={name}
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

/** A fact read, not set: a row laid out as a setting is, that nothing presses. */
const SettingsFact = ({ label, value, isCode = false }: SettingsFactProps) => {
  const styles = useStyles()
  return (
    <View accessibilityLabel={`${label}: ${value}`} accessible style={styles.toggle}>
      <Text style={[styles.name, styles.choiceLabel]}>{label}</Text>
      <Text style={[styles.factValue, isCode && styles.code]}>{value}</Text>
    </View>
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

type TouchTabProps<T extends string> = {
  tab: TabEntry<T>
  isChosen: boolean
  onChoose: (value: T) => void
}

/** A tab's label over its rule, in the text colour over the played line while chosen. */
const TouchTab = <T extends string>({ tab, isChosen, onChoose }: TouchTabProps<T>) => {
  const styles = useStyles()
  return (
    <Pressable
      {...tabA11yOf({ tab, isChosen })}
      onPress={() => onChoose(tab.value)}
      style={({ pressed }) => [styles.tab, isChosen && styles.tabChosen, pressed && styles.pressed]}
    >
      <Text
        variant={TEXT_VARIANTS.display}
        style={[styles.tabLabel, isChosen && styles.tabLabelChosen]}
      >
        {tab.label}
      </Text>
      {tab.count !== undefined && <Text style={styles.tabCount}>{tab.count}</Text>}
    </Pressable>
  )
}

/**
 * The web's tabs: their labels in a row ruled off underneath, the chosen one in the text colour
 * over the played line, the rest muted. A row wider than the screen scrolls sideways.
 */
const SettingsTabs = <T extends string>({
  label,
  tabs,
  chosen,
  onChoose,
}: SettingsTabsProps<T>) => {
  const styles = useStyles()
  return (
    <ScrollView
      horizontal
      accessibilityLabel={label}
      accessibilityRole="tablist"
      contentContainerStyle={styles.tabs}
      showsHorizontalScrollIndicator={false}
      style={styles.tabRule}
    >
      {tabs.map((tab) => (
        <TouchTab key={tab.value} isChosen={tab.value === chosen} onChoose={onChoose} tab={tab} />
      ))}
    </ScrollView>
  )
}

/** Settings on a phone or tablet: one page under the thumb, the system's switches and sheets. */
export const touchSettings: SettingsKit = {
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
    page: { gap: SIZES.space4, width: '100%' },
    measured: { maxWidth: SIZES.measure, alignSelf: 'center' },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
    section: { gap: SIZES.space2 },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
    note: { color: colours.muted, fontSize: SIZES.textSm },
    words: { flexShrink: 1, flexGrow: 1, gap: SIZES.space0 },
    choiceLabel: { flexShrink: 1, flexGrow: 1 },
    name: { flexShrink: 1, color: colours.text, fontSize: SIZES.text, fontWeight: '600' },
    line: { color: colours.muted, fontSize: SIZES.textSm },
    chipLabel: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
    factValue: { flexShrink: 1, color: colours.text, fontSize: SIZES.textSm },
    code: { fontFamily: CODE_FONT },
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
    tabRule: {
      flexGrow: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colours.line,
    },
    tabs: { gap: SIZES.space1 },
    tab: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: SIZES.space1,
      minHeight: SIZES.fieldHeight,
      paddingHorizontal: SIZES.space2,
      paddingVertical: SIZES.space1,
      borderBottomWidth: SIZES.tabRule,
      borderColor: 'transparent',
    },
    tabChosen: { borderColor: colours.played },
    tabLabel: { color: colours.muted, fontSize: SIZES.textLg },
    tabLabelChosen: { color: colours.text },
    tabCount: { color: colours.muted, fontSize: SIZES.textXs },
    pressed: { opacity: OPACITIES.pressed },
    off: { opacity: OPACITIES.disabled },
  }),
)
