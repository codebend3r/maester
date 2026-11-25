import type { Artist } from '@raven/core'
import { classNames } from '@raven/ui/headless'
import type { Ref } from 'react'
import { useCovers } from '@/music/useCovers'
import { artistPath } from '@/routes'
import { ArtistCard } from '@/ui/ArtistCard/ArtistCard'
import styles from '@/components/ArtistGrid/ArtistGrid.module.scss'

type ArtistGridProps = {
  artists: readonly Artist[]
  /** Where the place it sits in sets it: Artists lays its A to Z rail over the same area. */
  className?: string
  /** The list itself, whose children a jump scrolls to: Artists' A to Z rail. */
  ref?: Ref<HTMLUListElement>
}

/** Artists as a grid of cards, as many a row as fit, each opening the artist's page. */
export function ArtistGrid({ artists, className, ref }: ArtistGridProps) {
  const { artistPhotoOf } = useCovers()
  return (
    <ul className={classNames([styles.grid, className])} ref={ref}>
      {artists.map((artist) => (
        <li className={styles.cell} key={artist.id}>
          <ArtistCard
            albumCount={artist.albumCount}
            href={artistPath(artist.id)}
            name={artist.name}
            picture={artistPhotoOf(artist)}
            trackCount={artist.trackCount}
          />
        </li>
      ))}
    </ul>
  )
}
