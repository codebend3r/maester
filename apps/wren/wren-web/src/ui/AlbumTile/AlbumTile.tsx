import { type AlbumSummary, artistNames } from '@raven/core'
import { KIT_COPY } from '@raven/wren'
import { useState } from 'react'
import type { Cover, CoverOf } from '@/music/useCovers'
import { albumPath } from '@/routes'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { AlbumCoverMenu } from '@/ui/CoverMenu/CoverMenu'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/AlbumTile/AlbumTile.module.scss'

type AlbumTileProps = Press & {
  title: string
  /** The line under the title: the artists, or a playlist's count. */
  subtitle: string
  /** A third line, where the place adds one: the date Home's albums are ordered by. */
  detail?: string
  cover: Cover | null
  /** What the tile is called aloud: "OK Computer, Radiohead". */
  label: string
  /** What holding the cover does: an album's menu. A short tap still opens the tile. */
  onArtHold?: () => void
}

/**
 * An album or a playlist as a tile: its square art, its title, which wraps to four lines, and the
 * line under it, which wraps to two. It fills the column it is set in, a grid's or a shelf's.
 */
export function AlbumTile({
  title,
  subtitle,
  detail,
  cover,
  label,
  onArtHold,
  ...press
}: AlbumTileProps) {
  return (
    <Pressable {...press} className={styles.tile} label={label}>
      <AlbumArt cover={cover} onHold={onArtHold} />
      <span className={styles.text}>
        <span className={styles.title} title={title}>
          {title}
        </span>{' '}
        {/* The spaces keep the visible text inside the spoken name, "OK Computer, Radiohead". */}
        <span className={styles.subtitle} title={subtitle}>
          {subtitle}
        </span>
        {detail !== undefined && (
          <>
            {' '}
            <span className={styles.detail}>{detail}</span>
          </>
        )}
      </span>
    </Pressable>
  )
}

type AlbumTileOfProps = {
  album: AlbumSummary
  coverOf: CoverOf
  /** The line under the title; its artists unless the place says otherwise (an artist's years). */
  subtitle?: string
  /** A third line under the title, read out after the artists. */
  detail?: string
  /** What else a press does on the way to the album's page: Search remembers it. */
  onPress?: (album: AlbumSummary) => void
}

/**
 * An album as a tile, read out by its title, artists and any third line, that opens its page.
 * Holding its cover opens the album's menu: what it is, Go to album and Go to artist.
 */
export function AlbumTileOf({ album, coverOf, subtitle, detail, onPress }: AlbumTileOfProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const artists = artistNames(album)
  const label = KIT_COPY.labelled({ label: album.title, value: artists })
  return (
    <>
      <AlbumTile
        cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
        detail={detail}
        href={albumPath(album.id)}
        label={detail === undefined ? label : KIT_COPY.labelled({ label, value: detail })}
        onArtHold={() => setIsMenuOpen(true)}
        onPress={onPress === undefined ? undefined : () => onPress(album)}
        subtitle={subtitle ?? artists}
        title={album.title}
      />
      {isMenuOpen && <AlbumCoverMenu album={album} onClose={() => setIsMenuOpen(false)} />}
    </>
  )
}
