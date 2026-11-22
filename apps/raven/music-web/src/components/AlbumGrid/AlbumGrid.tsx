import type { AlbumSummary } from '@raven/core'
import { useCovers } from '@/music/useCovers'
import { AlbumTileOf } from '@/ui/AlbumTile/AlbumTile'
import { type GridColumns, TileGrid } from '@/ui/TileGrid/TileGrid'

type AlbumGridProps = {
  albums: readonly AlbumSummary[]
  /** How many a row holds on each layout, where it is not a grid's usual two and five. */
  columns?: GridColumns
  /** The line under an album's title, where it is not its artists: an artist's page says the year. */
  subtitleOf?: (album: AlbumSummary) => string
  /** What else a press does on the way to the album's page: Search remembers it. */
  onOpen?: (album: AlbumSummary) => void
}

/** Albums as a grid of tiles, each with its cover, opening its page. */
export function AlbumGrid({ albums, columns, subtitleOf, onOpen }: AlbumGridProps) {
  const { coverOf } = useCovers()
  return (
    <TileGrid
      columns={columns}
      items={albums}
      keyOf={(album) => album.id}
      renderTile={({ item }) => (
        <AlbumTileOf
          album={item}
          coverOf={coverOf}
          onPress={onOpen}
          subtitle={subtitleOf === undefined ? undefined : subtitleOf(item)}
        />
      )}
    />
  )
}
