import { View } from 'react-native'

import { SectionHeader } from '@/ui/Headers'
import { TileGrid } from '@/ui/TileGrid'
import { usePageStyles } from '@/ui/pageStyles'

type TileSectionProps<Item> = { title: string } & Parameters<typeof TileGrid<Item>>[0]

/**
 * A heading over a short grid of tiles, left out while it holds none: an artist's albums and the
 * albums they appear on, Favourites' artists and albums.
 */
export function TileSection<Item>({ title, items, keyOf, renderTile }: TileSectionProps<Item>) {
  const page = usePageStyles()
  return (
    items.length > 0 && (
      <View style={page.section}>
        <SectionHeader title={title} />
        <TileGrid items={items} keyOf={keyOf} renderTile={renderTile} />
      </View>
    )
  )
}
