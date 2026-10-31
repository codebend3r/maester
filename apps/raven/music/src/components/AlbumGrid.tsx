import type { AlbumSummary } from '@raven/core'
import { StyleSheet, View, useWindowDimensions } from 'react-native'

import { AlbumTile } from '@/components/AlbumTile'
import type { CoverOf } from '@/music/useCovers'
import { SIZES } from '@/theme/wrenTheme'

/** How many tiles a row of a page's albums holds: two on a phone, more on a wider screen. */
const columnsFor = (width: number): number => Math.max(2, Math.floor(width / (SIZES.measure / 3)))

/** How wide each of a page's album tiles is, `columns` to a row inside its padding. */
export const useTileWidth = () => {
  const { width } = useWindowDimensions()
  const columns = columnsFor(width)
  return {
    columns,
    tileWidth: (width - 2 * SIZES.space4 - (columns - 1) * SIZES.space3) / columns,
  }
}

type AlbumGridProps = { albums: readonly AlbumSummary[]; coverOf: CoverOf }

/** A short run of albums as rows of tiles, within a page that scrolls them. */
export function AlbumGrid({ albums, coverOf }: AlbumGridProps) {
  const { tileWidth } = useTileWidth()
  return (
    <View style={styles.grid}>
      {albums.map((album) => (
        <AlbumTile
          album={album}
          cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
          key={album.id}
          width={tileWidth}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space3 },
})
