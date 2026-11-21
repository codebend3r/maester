import type { Cover } from '@/music/useCovers'
import { type Size, SIZES, type TokenStyle } from '@/theme/tokens'
import { usePicture } from '@/ui/usePicture'
import styles from '@/ui/ArtistAvatar/ArtistAvatar.module.scss'

type ArtistAvatarProps = {
  name: string
  size?: Size
  /** The artist's picture, or null until the server has one, when the initial stands alone. */
  picture: Cover | null
}

/** An artist's circle: their picture, or their initial in Young Serif. Decorative beside their name. */
export function ArtistAvatar({ name, size = SIZES.avatar, picture }: ArtistAvatarProps) {
  const { src, onError } = usePicture({ picture })
  const style: TokenStyle = { '--avatar-size': size }
  return (
    <span aria-hidden="true" className={styles.avatar} style={style}>
      <span className={styles.initial}>{name.slice(0, 1).toUpperCase()}</span>
      {src !== null && (
        <img
          alt=""
          className={styles.image}
          decoding="async"
          loading="lazy"
          onError={onError}
          src={src}
        />
      )}
    </span>
  )
}
