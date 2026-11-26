import type { ComponentType } from 'react'
import { Pressable, Text } from 'react-native'

import { KIT_COPY, WREN_ICONS, type WrenIconName } from '@raven/wren'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { IconTile } from '@/ui/IconTile'
import { pressedStyleOf } from '@/ui/press'
import { WrenIcon } from '@/ui/WrenIcon'

/** Where a navigation row sits: Library's categories, or a Settings card. */
export const NAVIGATION_ROW_VARIANTS = { library: 'library', settings: 'settings' } as const

type NavigationRowVariant = (typeof NAVIGATION_ROW_VARIANTS)[keyof typeof NAVIGATION_ROW_VARIANTS]

/** The row's own styles, which a `FactRow` wears too. */
export const useRowStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s4, minHeight: SIZE.navRow },
  [NAVIGATION_ROW_VARIANTS.library]: { ...TYPE.rowLarge, color: colors.text, flex: 1 },
  [NAVIGATION_ROW_VARIANTS.settings]: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
  value: { ...TYPE.body, color: colors.text3 },
}))

type IconLeadProps = { icon: WrenIconName }

/** Library's lead: the icon alone, in red. */
function LibraryIcon({ icon }: IconLeadProps) {
  const { colors } = useWrenTheme()
  return <WrenIcon color={colors.accentText} name={icon} size={SIZE.icon} />
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

/** What a row holds, whether it opens something or reads a fact: its lead, label, value and chevron. */
export function RowBody({ label, icon, variant, value, hasChevron }: RowBodyProps) {
  const styles = useRowStyles()
  const { colors } = useWrenTheme()
  const Lead = ICON_LEADS[variant]
  return (
    <>
      {icon !== undefined && <Lead icon={icon} />}
      <Text numberOfLines={1} style={styles[variant]}>
        {label}
      </Text>
      {value !== undefined && <Text style={styles.value}>{value}</Text>}
      {hasChevron && (
        <WrenIcon color={colors.text3} name={WREN_ICONS.chevronRight} size={SIZE.smallIcon} />
      )}
    </>
  )
}

type NavigationRowProps = Omit<RowBodyProps, 'hasChevron'> & {
  /** What a press opens. */
  onPress: () => void
}

/**
 * A row that opens a page or a picker: its icon, its label, its value and a chevron. A row with
 * nothing to open is a `FactRow`.
 */
export function NavigationRow({ onPress, ...body }: NavigationRowProps) {
  const styles = useRowStyles()
  const { label, value } = body
  return (
    <Pressable
      accessibilityLabel={value === undefined ? label : KIT_COPY.labelled({ label, value })}
      accessibilityRole="button"
      onPress={onPress}
      style={pressedStyleOf({ style: styles.row })}
    >
      <RowBody {...body} hasChevron />
    </Pressable>
  )
}
