import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  group: { gap: SPACE.s2 },
  note: { ...TYPE.meta, color: colors.text2, paddingHorizontal: SPACE.s1 },
}))

type NotedGroupProps = {
  /** The line under the card: the server's is read only, the library's pick changes every list. */
  note: string
  /** The group's card. */
  children: ReactNode
}

/** A Settings group with a line of its own under the card, as the web's `NotedGroup`. */
export function NotedGroup({ note, children }: NotedGroupProps) {
  const styles = useStyles()
  return (
    <View style={styles.group}>
      {children}
      <Text style={styles.note}>{note}</Text>
    </View>
  )
}
