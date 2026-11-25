import { Text, View } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { IconTile } from '@/ui/IconTile'
import { type Choice, SegmentedControl } from '@/ui/SegmentedControl'
import type { WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  choice: { gap: SPACE.s3, paddingBottom: SPACE.s4, paddingTop: SPACE.s3 },
  head: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3, minHeight: SIZE.iconTile },
  label: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
  unit: { ...TYPE.meta, color: colors.text3 },
}))

type ChoiceRowProps<K extends string | number> = {
  label: string
  icon: WrenIconName
  /** The unit every choice is in, said once beside the heading rather than on each. */
  unit?: string
  /** What the control is called aloud, its unit included. */
  accessibilityLabel?: string
  choices: readonly Choice<K>[]
  selected: K
  onSelect: (key: K) => void
}

/** A setting named over a segmented control of the values it may take. */
export function ChoiceRow<K extends string | number>({
  label,
  icon,
  unit,
  accessibilityLabel = label,
  choices,
  selected,
  onSelect,
}: ChoiceRowProps<K>) {
  const styles = useStyles()
  return (
    <View style={styles.choice}>
      <View style={styles.head}>
        <IconTile icon={icon} />
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {unit !== undefined && <Text style={styles.unit}>{unit}</Text>}
      </View>
      <SegmentedControl
        choices={choices}
        label={accessibilityLabel}
        onSelect={onSelect}
        selected={selected}
      />
    </View>
  )
}
