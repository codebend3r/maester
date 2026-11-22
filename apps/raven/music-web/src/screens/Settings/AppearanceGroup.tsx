import { APPEARANCES, SETTINGS_COPY } from '@raven/wren'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'
import styles from '@/screens/Settings/AppearanceGroup.module.scss'

const APPEARANCE_CHOICES = [
  { key: APPEARANCES.system, label: SETTINGS_COPY.system },
  { key: APPEARANCES.light, label: SETTINGS_COPY.light },
  { key: APPEARANCES.dark, label: SETTINGS_COPY.dark },
] as const

/** Whether Wren follows the system's light or dark, or keeps one. */
export function AppearanceGroup() {
  const appearance = useWrenPrefs((state) => state.appearance)
  const change = useWrenPrefs((state) => state.change)
  return (
    <GroupedList heading={SETTINGS_COPY.appearance}>
      <div className={styles.row}>
        <SegmentedControl
          choices={APPEARANCE_CHOICES}
          label={SETTINGS_COPY.appearance}
          onSelect={(key) => change({ appearance: key })}
          selected={appearance}
        />
      </div>
    </GroupedList>
  )
}
