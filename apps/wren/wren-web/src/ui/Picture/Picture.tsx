import type { Cover } from '@/music/useCovers'
import { usePicture } from '@/ui/usePicture'
import styles from '@/ui/Picture/Picture.module.scss'

type PictureProps = {
  /** The server's picture, or null while it has none. */
  picture: Cover | null
}

/** The server's picture over whatever stands in for it; nothing when there is none or it will not load. */
export function Picture({ picture }: PictureProps) {
  const { src, onError } = usePicture({ picture })
  return (
    src !== null && (
      <img
        alt=""
        className={styles.picture}
        decoding="async"
        loading="lazy"
        onError={onError}
        src={src}
      />
    )
  )
}
