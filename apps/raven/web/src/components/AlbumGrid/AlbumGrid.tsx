import type { AlbumSummary } from '@raven/core'
import { Link } from 'react-router-dom'
import { ALBUM_GRID_COPY } from '@/components/AlbumGrid/copy'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { Bone } from '@/components/Skeleton/Skeleton'
import { albumPath, artistPath } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/AlbumGrid/AlbumGrid.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type AlbumCardProps = { album: AlbumSummary }

/** One album: its cover, linking to its page, with its title and artists under. */
const AlbumCard = ({ album }: AlbumCardProps) => (
  <li className={styles.card}>
    {/* The title under it is the link read aloud; the cover is the same link for the pointer. */}
    <Link to={albumPath(album.id)} className={styles.cover} aria-hidden="true" tabIndex={-1}>
      <AlbumCover album={album} sizes={POSTER_SIZES.grid} />
    </Link>
    <p className={styles.title}>
      <Link to={albumPath(album.id)}>{album.title}</Link>
    </p>
    <p className={styles.artists}>
      {album.artists.map((artist, index) => (
        <span key={artist.id}>
          {index > 0 && COMMON_COPY.listSeparator}
          <Link to={artistPath(artist.id)}>{artist.name}</Link>
        </span>
      ))}
      {album.year !== null && (
        <span className={styles.year}>{ALBUM_GRID_COPY.year(album.year)}</span>
      )}
    </p>
  </li>
)

type AlbumGridProps = { albums: readonly AlbumSummary[] }

/** Albums as a grid of covers, each named with its artists and year. */
export const AlbumGrid = ({ albums }: AlbumGridProps) => (
  <ul className={styles.grid}>
    {albums.map((album) => (
      <AlbumCard key={album.id} album={album} />
    ))}
  </ul>
)

/** How many blank covers stand in while the albums are on their way. */
const SKELETON_COUNT = 12

/** The grid while the albums are on their way. */
export const AlbumGridSkeleton = () => (
  <ul className={styles.grid} aria-hidden="true">
    {Array.from({ length: SKELETON_COUNT }, (_, index) => (
      <li key={index} className={styles.card}>
        <span className={styles.cover}>
          <Bone shape="fill" />
        </span>
        <Bone shape="text" width="most" />
        <Bone shape="text" width="short" />
      </li>
    ))}
  </ul>
)
