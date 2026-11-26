import { type ReactNode } from 'react'
import { View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(() => ({
  grid: { columnGap: SPACE.s4, flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.s6 },
}))

type TileGridProps<Item> = {
  items: readonly Item[]
  keyOf: (item: Item) => string | number
  renderTile: (item: Item) => ReactNode
}

/**
 * A short grid of tiles, wrapping as many to a row as the page's width holds: Home's albums, an
 * artist's. A long list is a `FlatList` of columns instead, which draws only what shows.
 */
export function TileGrid<Item>({ items, keyOf, renderTile }: TileGridProps<Item>) {
  const styles = useStyles()
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <View key={keyOf(item)}>{renderTile(item)}</View>
      ))}
    </View>
  )
}
