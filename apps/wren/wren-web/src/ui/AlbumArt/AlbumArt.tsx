import { WREN_ICONS } from '@raven/wren'
import { classNames } from '@raven/ui/headless'
import type { Cover } from '@/music/useCovers'
import type { Radius, Size, TokenStyle } from '@/theme/tokens'
import { Picture } from '@/ui/Picture/Picture'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/AlbumArt/AlbumArt.module.scss'

type AlbumArtProps = {
  /** The server's cover, or null for an album that has none. */
  cover: Cover | null
  /** A fixed size of the kit; left out, the art fills the width it is given. */
  size?: Size
  radius?: Radius
  /** Whether it is a page's large cover, lifted off the ground on a soft shadow. */
  isRaised?: boolean
}

/**
 * An album's cover, square. Under it, and in its place when there is none or it will not load,
 * a quiet square with a note, so a cover still on its way never leaves a hole.
 */
export function AlbumArt({ cover, size, radius, isRaised = false }: AlbumArtProps) {
  const style: TokenStyle = { '--art-size': size, '--art-radius': radius }
  return (
    <span className={classNames([styles.art, isRaised && styles.raised])} style={style}>
      <WrenIcon name={WREN_ICONS.song} />
      <Picture picture={cover} />
    </span>
  )
}
