import { type AlbumSummary, artistNames } from '@raven/core'
import { KIT_COPY } from '@raven/wren'
import type { Cover, CoverOf } from '@/music/useCovers'
import { albumPath } from '@/routes'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/AlbumTile/AlbumTile.module.scss'

type AlbumTileProps = Press & {
  title: string
  /** The line under the title: the artists, or a playlist's count. */
  subtitle: string
  cover: Cover | null
  /** What the tile is called aloud: "OK Computer, Radiohead". */
  label: string
}

/**
 * An album or a playlist as a tile: its square art, its title and a line under it, each on one
 * line. It fills the column it is set in, a grid's or a shelf's.
 */
export function AlbumTile({ title, subtitle, cover, label, ...press }: AlbumTileProps) {
  return (
    <Pressable {...press} className={styles.tile} label={label}>
      <AlbumArt cover={cover} />
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>
    </Pressable>
  )
}

type AlbumTileOfProps = {
  album: AlbumSummary
  coverOf: CoverOf
  /** The line under the title; its artists unless the place says otherwise (an artist's years). */
  subtitle?: string
  /** What else a press does on the way to the album's page: Search remembers it. */
  onPress?: (album: AlbumSummary) => void
}

/** An album as a tile, read out by its title and artists, that opens its page. */
export function AlbumTileOf({ album, coverOf, subtitle, onPress }: AlbumTileOfProps) {
  const artists = artistNames(album)
  return (
    <AlbumTile
      cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
      href={albumPath(album.id)}
      label={KIT_COPY.labelled({ label: album.title, value: artists })}
      onPress={onPress === undefined ? undefined : () => onPress(album)}
      subtitle={subtitle ?? artists}
      title={album.title}
    />
  )
}
