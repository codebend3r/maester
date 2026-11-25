import type { Cover } from '@/music/useCovers'
import { type Radius, type Size, SIZES, type TokenStyle } from '@/theme/tokens'
import { Picture } from '@/ui/Picture/Picture'
import styles from '@/ui/ArtistAvatar/ArtistAvatar.module.scss'

type ArtistAvatarProps = {
  name: string
  size?: Size
  /** Its corners, where it is no circle: an artist's card rounds a square. */
  radius?: Radius
  /** The artist's picture, or null until the server has one, when the initial stands alone. */
  picture: Cover | null
}

/** An artist's circle: their picture, or their initial in Young Serif. Decorative beside their name. */
export function ArtistAvatar({ name, size = SIZES.avatar, radius, picture }: ArtistAvatarProps) {
  const style: TokenStyle = { '--avatar-size': size, '--avatar-radius': radius }
  return (
    <span aria-hidden="true" className={styles.avatar} style={style}>
      <span className={styles.initial}>{name.slice(0, 1).toUpperCase()}</span>
      <Picture picture={picture} />
    </span>
  )
}
