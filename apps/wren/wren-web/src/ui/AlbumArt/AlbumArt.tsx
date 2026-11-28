import { WREN_ICONS } from '@raven/wren'
import { classNames, useLongPress } from '@raven/ui/headless'
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
  /** What a touch long press or a right click on the cover does: its menu. Left out, it holds nothing. */
  onHold?: () => void
}

/** What the hook is given for a cover with no menu, whose handlers it never wears. */
const holdNothing = (): void => {}

/**
 * An album's cover, square. Under it, and in its place when there is none or it will not load,
 * a quiet square with a note, so a cover still on its way never leaves a hole. Given `onHold`,
 * the cover and its placeholder alike open their menu when held.
 */
export function AlbumArt({ cover, size, radius, isRaised = false, onHold }: AlbumArtProps) {
  const style: TokenStyle = { '--art-size': size, '--art-radius': radius }
  const hold = useLongPress({ onLongPress: onHold ?? holdNothing })
  const holdProps = onHold === undefined ? {} : hold
  return (
    <span
      {...holdProps}
      className={classNames([
        styles.art,
        isRaised && styles.raised,
        onHold !== undefined && styles.holdable,
      ])}
      style={style}
    >
      <WrenIcon name={WREN_ICONS.song} />
      <Picture picture={cover} />
    </span>
  )
}
