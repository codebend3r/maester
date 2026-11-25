import type { AlbumSummary } from '@raven/core'
import type { CoverOf } from '@/music/useCovers'
import { AlbumTileOf } from '@/ui/AlbumTile/AlbumTile'
import styles from '@/ui/Shelf/Shelf.module.scss'

type ShelfProps = {
  albums: readonly AlbumSummary[]
  coverOf: CoverOf
  /** What else a press on a tile does on the way to the album's page. */
  onOpen?: (album: AlbumSummary) => void
}

/** Albums in a row of tiles that scrolls sideways, running out to the page's edges. */
export function Shelf({ albums, coverOf, onOpen }: ShelfProps) {
  return (
    <ul className={styles.shelf}>
      {albums.map((album) => (
        <li className={styles.cell} key={album.id}>
          <AlbumTileOf album={album} coverOf={coverOf} onPress={onOpen} />
        </li>
      ))}
    </ul>
  )
}
