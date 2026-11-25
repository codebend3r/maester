import {
  type ColorScheme,
  SETTINGS_COPY,
  THEME_MODES,
  themeFor,
  withThemePicked,
  themePickerLabelOf,
} from '@raven/wren'
import { useState } from 'react'
import { ThemePicker } from '@/screens/Settings/ThemePicker'
import { ThemeSlots } from '@/screens/Settings/ThemeSlots'
import { useThemeChoice, useWrenPrefs } from '@/stores/wrenPrefs'
import { systemScheme } from '@/theme/systemScheme'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'
import styles from '@/screens/Settings/AppearanceGroup.module.scss'

const MODE_CHOICES = [
  { key: THEME_MODES.system, label: SETTINGS_COPY.themeModes[THEME_MODES.system] },
  { key: THEME_MODES.single, label: SETTINGS_COPY.themeModes[THEME_MODES.single] },
] as const

/**
 * The theme Wren wears: one for each of the device's schemes, switched as the device goes light
 * or dark, or one whatever the device says. The picker sets the slot picked above it in the
 * first mode, which starts on the slot showing, and the one theme in the second.
 */
export function AppearanceGroup() {
  const choice = useThemeChoice()
  const change = useWrenPrefs((state) => state.change)
  const [slot, setSlot] = useState<ColorScheme>(systemScheme)
  const isFollowing = choice.themeMode === THEME_MODES.system
  const pickerLabel = themePickerLabelOf({ choice, slot })
  return (
    <GroupedList heading={SETTINGS_COPY.appearance}>
      <div className={styles.group}>
        <SegmentedControl
          choices={MODE_CHOICES}
          label={SETTINGS_COPY.themeMode}
          onSelect={(key) => change({ themeMode: key })}
          selected={choice.themeMode}
        />
        <p className={styles.note}>{SETTINGS_COPY.themeModeNotes[choice.themeMode]}</p>
        {isFollowing && <ThemeSlots choice={choice} onSelect={setSlot} slot={slot} />}
        <p className={styles.heading}>{pickerLabel}</p>
        <ThemePicker
          label={pickerLabel}
          onSelect={(picked) => change(withThemePicked({ choice, scheme: slot, theme: picked }))}
          selected={themeFor({ choice, scheme: slot })}
        />
      </div>
    </GroupedList>
  )
}
