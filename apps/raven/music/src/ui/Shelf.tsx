import type { AlbumSummary } from '@raven/core'
import { FlatList, StyleSheet } from 'react-native'

import type { CoverOf } from '@/music/useCovers'
import { usePageInsets } from '@/shell/useShell'
import { SIZE } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { GRID_GAP } from '@/ui/TileGrid'

const styles = StyleSheet.create({ shelf: { gap: GRID_GAP } })

type ShelfProps = {
  albums: readonly AlbumSummary[]
  coverOf: CoverOf
  /** What a press on a tile does, when it is more than opening the album. */
  onOpen?: (album: AlbumSummary) => void
}

/** Albums in a row of tiles that scrolls sideways, running out to the screen's edges. */
export function Shelf({ albums, coverOf, onOpen }: ShelfProps) {
  const { paddingLeft, paddingRight } = usePageInsets()
  return (
    <FlatList
      contentContainerStyle={[styles.shelf, { paddingLeft, paddingRight }]}
      data={albums}
      horizontal
      keyExtractor={(album) => String(album.id)}
      renderItem={({ item }) => (
        <AlbumTileOf album={item} coverOf={coverOf} onPress={onOpen} width={SIZE.shelfTile} />
      )}
      showsHorizontalScrollIndicator={false}
      style={{ marginLeft: -paddingLeft, marginRight: -paddingRight }}
    />
  )
}
