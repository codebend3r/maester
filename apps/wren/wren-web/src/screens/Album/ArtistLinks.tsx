import type { ArtistCredit } from '@raven/core'
import { ALBUM_COPY } from '@raven/wren'
import { artistPath } from '@/routes'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/screens/Album/ArtistLinks.module.scss'

type ArtistLinksProps = { artists: readonly ArtistCredit[] }

/** An album's artists in red under its title, each a link to the artist's page. */
export function ArtistLinks({ artists }: ArtistLinksProps) {
  return (
    <ul className={styles.links}>
      {artists.map((artist) => (
        <li className={styles.name} key={artist.id}>
          <Pressable
            className={styles.link}
            href={artistPath(artist.id)}
            label={ALBUM_COPY.openArtist(artist.name)}
          >
            {artist.name}
          </Pressable>
        </li>
      ))}
    </ul>
  )
}
