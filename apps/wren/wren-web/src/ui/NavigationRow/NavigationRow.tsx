import { classNames } from '@raven/ui/headless'
import { KIT_COPY } from '@raven/wren'
import type { ComponentType } from 'react'
import { COLORS, SIZES } from '@/theme/tokens'
import { IconTile } from '@/ui/IconTile/IconTile'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/NavigationRow/NavigationRow.module.scss'

/** Where a navigation row sits: Library's categories, or a Settings card. */
export const NAVIGATION_ROW_VARIANTS = { library: 'library', settings: 'settings' } as const

type NavigationRowVariant = (typeof NAVIGATION_ROW_VARIANTS)[keyof typeof NAVIGATION_ROW_VARIANTS]

type IconLeadProps = { icon: WrenIconName }

/** Library's lead: the icon alone, in red. */
function LibraryIcon({ icon }: IconLeadProps) {
  return <WrenIcon color={COLORS.accentText} name={icon} size={SIZES.icon} />
}

const ICON_LEADS = {
  [NAVIGATION_ROW_VARIANTS.library]: LibraryIcon,
  [NAVIGATION_ROW_VARIANTS.settings]: IconTile,
} as const satisfies Record<NavigationRowVariant, ComponentType<IconLeadProps>>

type RowBodyProps = {
  label: string
  /** Its lead; left out, the label starts the row: Licenses. */
  icon?: WrenIconName
  variant: NavigationRowVariant
  /** What it holds or is set to, quiet at the row's end: "1,980", "Off". */
  value?: string
  hasChevron: boolean
}

type RowClassOfProps = Pick<RowBodyProps, 'icon'>

/** The row's own class, with room for a lead when it has one. */
export const rowClassOf = ({ icon }: RowClassOfProps): string =>
  classNames([styles.row, icon !== undefined && styles.led])

/** What a row holds, whether it opens something or reads a fact: its lead, label, value and chevron. */
export function RowBody({ label, icon, variant, value, hasChevron }: RowBodyProps) {
  const Lead = ICON_LEADS[variant]
  return (
    <>
      {icon !== undefined && <Lead icon={icon} />}
      <span className={classNames([styles.label, styles[variant]])}>{label}</span>
      {/* The space keeps the visible text, "Albums 1", inside the spoken name, "Albums, 1". */}
      {value !== undefined && ' '}
      <span className={styles.end}>
        {value !== undefined && <span className={styles.value}>{value}</span>}
        {hasChevron && (
          <WrenIcon color={COLORS.text3} name={ICONS.chevronRight} size={SIZES.smallIcon} />
        )}
      </span>
    </>
  )
}

type NavigationRowProps = Press & Omit<RowBodyProps, 'hasChevron'>

/**
 * A row that opens a page or a picker: its icon, its label, its value and a chevron. A row with
 * nothing to open is a `FactRow`.
 */
export function NavigationRow({ label, icon, variant, value, ...press }: NavigationRowProps) {
  return (
    <Pressable
      {...press}
      className={rowClassOf({ icon })}
      label={value === undefined ? label : KIT_COPY.labelled({ label, value })}
    >
      <RowBody hasChevron icon={icon} label={label} value={value} variant={variant} />
    </Pressable>
  )
}
