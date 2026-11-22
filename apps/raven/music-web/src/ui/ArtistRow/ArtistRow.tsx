import { countsLineOf } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { ArtistAvatar } from '@/ui/ArtistAvatar/ArtistAvatar'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/ArtistRow/ArtistRow.module.scss'

type ArtistRowProps = Press & {
  name: string
  albumCount: number
  trackCount: number
  picture: Cover | null
}

/** An artist in a list: their circle, their name, and what they hold with the zeros left out. */
export function ArtistRow({ name, albumCount, trackCount, picture, ...press }: ArtistRowProps) {
  const counts = countsLineOf({ albums: albumCount, tracks: trackCount })
  return (
    <Pressable {...press} className={styles.row} label={name}>
      <ArtistAvatar name={name} picture={picture} />
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {counts !== '' && <span className={styles.counts}>{counts}</span>}
      </span>
    </Pressable>
  )
}
