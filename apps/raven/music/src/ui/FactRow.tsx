import { View } from 'react-native'

import { KIT_COPY } from '@raven/wren'
import { NAVIGATION_ROW_VARIANTS, RowBody, useRowStyles } from '@/ui/NavigationRow'
import type { WrenIconName } from '@/ui/WrenIcon'

type FactRowProps = {
  label: string
  /** Its lead; left out, the label starts the row. */
  icon?: WrenIconName
  /** What the row says of its label: the version. */
  value: string
}

/**
 * A Settings card's row with nothing to open: its label and value read together, with no
 * chevron: Version.
 */
export function FactRow({ label, icon, value }: FactRowProps) {
  const styles = useRowStyles()
  return (
    <View accessibilityLabel={KIT_COPY.labelled({ label, value })} accessible style={styles.row}>
      <RowBody
        hasChevron={false}
        icon={icon}
        label={label}
        value={value}
        variant={NAVIGATION_ROW_VARIANTS.settings}
      />
    </View>
  )
}
