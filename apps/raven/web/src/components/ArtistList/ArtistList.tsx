import type { Artist } from '@raven/core'
import { Link } from 'react-router-dom'
import { artistPath } from '@/lib/music'
import { MUSIC_COPY } from '@/lib/copy'
import styles from '@/components/ArtistList/ArtistList.module.scss'

type ArtistListProps = {
  artists: readonly Artist[]
  /** What the list is read aloud as. */
  label: string
}

/** Artists as tiles, each linking to their page with how many albums and tracks are theirs. */
export const ArtistList = ({ artists, label }: ArtistListProps) => (
  <ul className={styles.artists} aria-label={label}>
    {artists.map((artist) => (
      <li key={artist.id} className={styles.artist}>
        <Link to={artistPath(artist.id)} className={styles.name}>
          {artist.name}
        </Link>
        <span className={styles.count}>{MUSIC_COPY.artistCounts(artist)}</span>
      </li>
    ))}
  </ul>
)
