import type { AlbumSummary } from '@raven/core'
import type { CoverSize } from '@raven/wren'
import { useCovers } from '@/music/useCovers'
import { AlbumTileOf } from '@/ui/AlbumTile/AlbumTile'
import { type GridColumns, TileGrid } from '@/ui/TileGrid/TileGrid'

type AlbumGridProps = {
  albums: readonly AlbumSummary[]
  /** How many a row holds on each layout, where it is not a grid's usual two and five. */
  columns?: GridColumns
  /** As many tiles a row as this size allows, in place of `columns`: Albums' cover size. */
  tileSize?: CoverSize
  /** The line under an album's title, where it is not its artists: an artist's page says the year. */
  subtitleOf?: (album: AlbumSummary) => string
  /** A third line under each album, where the place adds one: Home's date. */
  detailOf?: (album: AlbumSummary) => string
  /** What else a press does on the way to the album's page: Search remembers it. */
  onOpen?: (album: AlbumSummary) => void
}

/** Albums as a grid of tiles, each with its cover, opening its page. */
export function AlbumGrid({
  albums,
  columns,
  tileSize,
  subtitleOf,
  detailOf,
  onOpen,
}: AlbumGridProps) {
  const { coverOf } = useCovers()
  return (
    <TileGrid
      columns={columns}
      items={albums}
      tileSize={tileSize}
      keyOf={(album) => album.id}
      renderTile={({ item }) => (
        <AlbumTileOf
          album={item}
          coverOf={coverOf}
          detail={detailOf === undefined ? undefined : detailOf(item)}
          onPress={onOpen}
          subtitle={subtitleOf === undefined ? undefined : subtitleOf(item)}
        />
      )}
    />
  )
}
