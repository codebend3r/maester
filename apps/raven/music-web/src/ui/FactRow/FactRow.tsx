import { NAVIGATION_ROW_VARIANTS, RowBody, rowClassOf } from '@/ui/NavigationRow/NavigationRow'
import type { WrenIconName } from '@/ui/WrenIcon/icons'

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
  return (
    <p className={rowClassOf({ icon })}>
      <RowBody
        hasChevron={false}
        icon={icon}
        label={label}
        value={value}
        variant={NAVIGATION_ROW_VARIANTS.settings}
      />
    </p>
  )
}
