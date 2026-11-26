import type { ReactElement, ReactNode } from 'react'
import { FlatList } from 'react-native'

import { PAGE_WIDTH } from '@/shell/layout'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { columnsFitting } from '@/ui/grid'

const useStyles = themedStyles(({ colors }) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s4, padding: SPACE.gutter },
  columns: { gap: SPACE.s4 },
}))

type CollectionGridProps<Item> = {
  items: readonly Item[]
  keyOf: (item: Item) => number
  /** One tile's width, which sets how many columns fit the page. */
  tile: number
  /** The page's head: its title, count, search box and tools. */
  header: ReactElement
  /** What stands in the tiles' place while there are none. */
  empty: ReactElement
  renderTile: (item: Item) => ReactNode
}

/**
 * A category page as a grid of tiles (Albums, Artists, Unmatched albums, Playlists): its head, then
 * as many columns as fit the page at the tile's width, drawing only what shows.
 */
export function CollectionGrid<Item>({
  items,
  keyOf,
  tile,
  header,
  empty,
  renderTile,
}: CollectionGridProps<Item>) {
  const styles = useStyles()
  const columns = columnsFitting({ width: PAGE_WIDTH, tile, gap: SPACE.s4 })
  return (
    <FlatList
      ListEmptyComponent={empty}
      ListHeaderComponent={header}
      // React Native refuses a row's style on a list of one column.
      columnWrapperStyle={columns > 1 && styles.columns}
      contentContainerStyle={styles.content}
      data={items}
      // A change in columns makes a new list: React Native cannot change them in place.
      key={columns}
      keyExtractor={(item) => String(keyOf(item))}
      numColumns={columns}
      renderItem={({ item }) => renderTile(item)}
      style={styles.ground}
    />
  )
}
