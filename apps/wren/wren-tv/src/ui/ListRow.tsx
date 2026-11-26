import { type ReactNode } from 'react'
import { Text, View } from 'react-native'

import { KIT_COPY } from '@raven/wren'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { Focusable, type FocusableProps } from '@/ui/Focusable'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  row: {
    alignItems: 'center',
    borderRadius: RADIUS.item,
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.row,
    paddingHorizontal: SPACE.s3,
  },
  lit: { backgroundColor: colors.surface2 },
  words: { flex: 1, gap: SPACE.s1 / 2 },
  title: { ...TYPE.row, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
  value: { ...TYPE.meta, color: colors.text2 },
}))

type ListRowProps = Omit<FocusableProps, 'children' | 'style' | 'focusedStyle' | 'label'> & {
  title: string
  /** A quiet line under the title. */
  line?: string | null
  /** What it is set to or holds, at its end: "Night", "24". */
  value?: string | null
  /** A drawing at its start; `lead` takes its place for a picture. */
  icon?: WrenIconName
  lead?: ReactNode
  /** Whether it opens somewhere, which a chevron at its end says. */
  canOpen?: boolean
}

/**
 * A row of the TV's lists: Library's categories, Settings' choices, a search's artists. It reads
 * as its title and, when it has one, its value ("Theme, Night"); the remote lights its ground.
 */
export function ListRow({
  title,
  line = null,
  value = null,
  icon,
  lead,
  canOpen = false,
  ...props
}: ListRowProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const label = value === null ? title : KIT_COPY.labelled({ label: title, value })
  return (
    <Focusable
      {...props}
      focusedStyle={styles.lit}
      hasRing={false}
      label={label}
      style={styles.row}
    >
      {({ isFocused }) => (
        <>
          {lead}
          {icon !== undefined && (
            <WrenIcon color={isFocused ? colors.accentText : colors.text2} name={icon} />
          )}
          <View style={styles.words}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {line !== null && (
              <Text numberOfLines={1} style={styles.line}>
                {line}
              </Text>
            )}
          </View>
          {value !== null && <Text style={styles.value}>{value}</Text>}
          {canOpen && (
            <WrenIcon color={colors.text3} name={ICONS.chevronRight} size={SIZE.iconSmall} />
          )}
        </>
      )}
    </Focusable>
  )
}
