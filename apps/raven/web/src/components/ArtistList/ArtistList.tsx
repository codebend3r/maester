import type { Artist } from '@raven/core'
import { Link } from 'react-router-dom'
import { Picture } from '@/components/PosterImage/PosterImage'
import { useMusicLinks } from '@/lib/useMusicLinks'
import styles from '@/components/ArtistList/ArtistList.module.scss'
import { api } from '@/lib/api'
import { MUSIC_COPY } from '@/lib/copy'

type ArtistListProps = {
  artists: readonly Artist[]
  /** What the list is read aloud as. */
  label: string
}

const photoSources = (artist: Artist): { src: string }[] => {
  const src = api.artistPhotoUrl({ artistId: artist.id, photoVersion: artist.photoVersion })
  return src === null ? [] : [{ src }]
}

/** Artists as tiles, each linking to their page with how many albums and tracks are theirs. */
export const ArtistList = ({ artists, label }: ArtistListProps) => {
  const links = useMusicLinks()
  return (
    <ul className={styles.artists} aria-label={label}>
      {artists.map((artist) => (
        <li key={artist.id} className={styles.artist}>
          <span className={styles.photo}>
            <Picture sources={photoSources(artist)} initial={artist.name.slice(0, 1)} />
          </span>
          <Link to={links.artist(artist.id)} className={styles.name}>
            {artist.name}
          </Link>
          <span className={styles.count}>{MUSIC_COPY.artistCounts(artist)}</span>
        </li>
      ))}
    </ul>
  )
}
