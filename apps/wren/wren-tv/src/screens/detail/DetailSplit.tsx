import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(({ colors }) => ({
  split: {
    backgroundColor: colors.bg,
    flex: 1,
    flexDirection: 'row',
    gap: SPACE.s8,
    padding: SPACE.gutter,
  },
  list: { flex: 1 },
}))

type DetailSplitProps = {
  /** The head, which keeps its column whole and scrolls on its own when it is taller. */
  head: ReactNode
  /** The tracks, or an artist's albums, laid out in the rest of the width. */
  list: ReactNode
}

/** An album's, a playlist's or an artist's page on a TV: the head at the left, the list beside it. */
export function DetailSplit({ head, list }: DetailSplitProps) {
  const styles = useStyles()
  return (
    <View style={styles.split}>
      <ScrollView>{head}</ScrollView>
      <View style={styles.list}>{list}</View>
    </View>
  )
}
