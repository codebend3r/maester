import { countsLineOf } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { RADII, SIZES } from '@/theme/tokens'
import { ArtistAvatar } from '@/ui/ArtistAvatar/ArtistAvatar'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/ArtistCard/ArtistCard.module.scss'

type ArtistCardProps = Press & {
  name: string
  albumCount: number
  trackCount: number
  picture: Cover | null
}

/**
 * An artist in a grid, as raven's Artists tab draws one: their photo, or their initial, beside
 * their name in the display face and what they hold under it, the zeros left out.
 */
export function ArtistCard({ name, albumCount, trackCount, picture, ...press }: ArtistCardProps) {
  const counts = countsLineOf({ albums: albumCount, tracks: trackCount })
  return (
    <Pressable {...press} className={styles.card} label={name}>
      <span className={styles.photo}>
        <ArtistAvatar name={name} picture={picture} radius={RADII.md} size={SIZES.artistPhoto} />
      </span>
      <span className={styles.name}>{name}</span>
      {counts !== '' && <span className={styles.counts}>{counts}</span>}
    </Pressable>
  )
}
