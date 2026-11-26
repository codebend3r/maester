import type { ReactNode } from 'react'
import { KIT_COPY } from '@raven/wren'
import { Text, View } from 'react-native'

import { RADIUS, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { SectionHeader } from '@/ui/Headers'

const useStyles = themedStyles(({ colors }) => ({
  group: { gap: SPACE.s2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    gap: SPACE.s1,
    padding: SPACE.s3,
  },
  note: { ...TYPE.meta, color: colors.text2, paddingHorizontal: SPACE.s1 },
  fact: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    paddingHorizontal: SPACE.s3,
    paddingVertical: SPACE.s2,
  },
  factLabel: { ...TYPE.row, color: colors.text, flex: 1 },
  factValue: { ...TYPE.meta, color: colors.text2 },
}))

type SettingsGroupProps = {
  heading: string
  /** A line of its own under the card: the server's is read only, the library's pick changes every list. */
  note?: string
  children: ReactNode
}

/** A Settings group: its heading over a card of rows, and its note under it. */
export function SettingsGroup({ heading, note, children }: SettingsGroupProps) {
  const styles = useStyles()
  return (
    <View style={styles.group}>
      <SectionHeader title={heading} />
      <View style={styles.card}>{children}</View>
      {note !== undefined && <Text style={styles.note}>{note}</Text>}
    </View>
  )
}

type FactRowProps = { label: string; value: string }

/** A row with nothing to open, which reads a fact: "Address, https://raven.example". */
export function FactRow({ label, value }: FactRowProps) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={KIT_COPY.labelled({ label, value })} accessible style={styles.fact}>
      <Text numberOfLines={1} style={styles.factLabel}>
        {label}
      </Text>
      <Text numberOfLines={1} style={styles.factValue}>
        {value}
      </Text>
    </View>
  )
}
