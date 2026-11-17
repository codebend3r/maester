import type { ComponentType } from 'react'
import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { KIT_COPY } from '@/ui/copy'
import { IconTile } from '@/ui/IconTile'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

/** Where a navigation row sits: Library's categories, or a Settings card. */
export const NAVIGATION_ROW_VARIANTS = { library: 'library', settings: 'settings' } as const

type NavigationRowVariant = (typeof NAVIGATION_ROW_VARIANTS)[keyof typeof NAVIGATION_ROW_VARIANTS]

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
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

type NavigationRowProps = {
  label: string
  /** Its lead; left out, the label starts the row: Licenses. */
  icon?: WrenIconName
  /** What a press opens; left out, the row is a fact read, not a link: Version. */
  onPress?: () => void
  variant?: NavigationRowVariant
  /** What it holds or is set to, quiet before the chevron: "1,980", "Off". */
  value?: string
}

type RowBodyProps = Omit<NavigationRowProps, 'onPress'> & { hasChevron: boolean }

function RowBody({
  label,
  icon,
  variant = NAVIGATION_ROW_VARIANTS.library,
  value,
  hasChevron,
}: RowBodyProps) {
  const styles = useStyles()
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
        <WrenIcon color={colors.text3} name={ICONS.chevronRight} size={SIZE.smallIcon} />
      )}
    </>
  )
}

type RowOfProps = NavigationRowProps & { spoken: string }

/** A row with something to open: pressed, it opens it. */
function LinkRow({ onPress, spoken, ...body }: RowOfProps) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={spoken}
      accessibilityRole="button"
      onPress={onPress}
      style={pressedStyleOf({ style: styles.row })}
    >
      <RowBody {...body} hasChevron />
    </Pressable>
  )
}

/** A row with nothing to open: its label and value read together. */
function FactRow({ spoken, ...body }: RowOfProps) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={spoken} accessible style={styles.row}>
      <RowBody {...body} hasChevron={false} />
    </View>
  )
}

/** Whether a row opens something or reads a fact. */
const ROW_KINDS = { link: 'link', fact: 'fact' } as const

type RowKind = (typeof ROW_KINDS)[keyof typeof ROW_KINDS]

const ROW_VIEWS = {
  [ROW_KINDS.link]: LinkRow,
  [ROW_KINDS.fact]: FactRow,
} as const satisfies Record<RowKind, ComponentType<RowOfProps>>

/**
 * A row that opens a page or a picker: its icon, its label, its value and a chevron. With
 * nothing to open it reads a fact, its label and value said together, and has no chevron.
 */
export function NavigationRow(props: NavigationRowProps) {
  const { label, value, onPress } = props
  const spoken = value === undefined ? label : KIT_COPY.labelled({ label, value })
  const Row = ROW_VIEWS[onPress === undefined ? ROW_KINDS.fact : ROW_KINDS.link]
  return <Row {...props} spoken={spoken} />
}
