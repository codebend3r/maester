import {
  type ColorScheme,
  SETTINGS_COPY,
  THEME_MODES,
  themeFor,
  withThemePicked,
  themePickerLabelOf,
} from '@raven/wren'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { ThemePicker } from '@/screens/settings/ThemePicker'
import { ThemeSlots } from '@/screens/settings/ThemeSlots'
import { useThemeChoice, useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles, useSystemScheme } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { GroupedList } from '@/ui/GroupedList'
import { SegmentedControl } from '@/ui/SegmentedControl'

const MODE_CHOICES = [
  { key: THEME_MODES.system, label: SETTINGS_COPY.themeModes[THEME_MODES.system] },
  { key: THEME_MODES.single, label: SETTINGS_COPY.themeModes[THEME_MODES.single] },
] as const

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  group: { gap: SPACE.s4, paddingVertical: SPACE.s4 },
  note: { ...TYPE.meta, color: colors.text2 },
  heading: { ...TYPE.metaStrong, color: colors.text },
}))

/**
 * The theme Wren wears: one for each of the device's schemes, switched as the device goes light
 * or dark, or one whatever the device says. The picker sets the slot picked above it in the
 * first mode, which starts on the slot showing, and the one theme in the second.
 */
export function AppearanceGroup() {
  const styles = useStyles()
  const choice = useThemeChoice()
  const change = useWrenPrefs((state) => state.change)
  const system = useSystemScheme()
  const [slot, setSlot] = useState<ColorScheme>(system)
  const isFollowing = choice.themeMode === THEME_MODES.system
  const pickerLabel = themePickerLabelOf({ choice, slot })
  return (
    <GroupedList heading={SETTINGS_COPY.appearance}>
      <View style={styles.group}>
        <SegmentedControl
          choices={MODE_CHOICES}
          label={SETTINGS_COPY.themeMode}
          onSelect={(key) => change({ themeMode: key })}
          selected={choice.themeMode}
        />
        <Text style={styles.note}>{SETTINGS_COPY.themeModeNotes[choice.themeMode]}</Text>
        {isFollowing && <ThemeSlots choice={choice} onSelect={setSlot} slot={slot} />}
        <Text style={styles.heading}>{pickerLabel}</Text>
        <ThemePicker
          label={pickerLabel}
          onSelect={(picked) => change(withThemePicked({ choice, scheme: slot, theme: picked }))}
          selected={themeFor({ choice, scheme: slot })}
        />
      </View>
    </GroupedList>
  )
}
