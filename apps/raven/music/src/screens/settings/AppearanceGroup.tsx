import { APPEARANCES, SETTINGS_COPY } from '@raven/wren'
import { View } from 'react-native'

import { useWrenPrefs } from '@/stores/wrenPrefs'
import { themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { GroupedList } from '@/ui/GroupedList'
import { SegmentedControl } from '@/ui/SegmentedControl'

const APPEARANCE_CHOICES = [
  { key: APPEARANCES.system, label: SETTINGS_COPY.system },
  { key: APPEARANCES.light, label: SETTINGS_COPY.light },
  { key: APPEARANCES.dark, label: SETTINGS_COPY.dark },
] as const

const useStyles = themedStyles(() => ({ row: { paddingVertical: SPACE.s3 } }))

/** Whether Wren follows the system's light or dark, or keeps one. */
export function AppearanceGroup() {
  const styles = useStyles()
  const appearance = useWrenPrefs((state) => state.appearance)
  const change = useWrenPrefs((state) => state.change)
  return (
    <GroupedList heading={SETTINGS_COPY.appearance}>
      <View style={styles.row}>
        <SegmentedControl
          choices={APPEARANCE_CHOICES}
          label={SETTINGS_COPY.appearance}
          onSelect={(key) => change({ appearance: key })}
          selected={appearance}
        />
      </View>
    </GroupedList>
  )
}
