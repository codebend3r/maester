import { type MenuLike, TRACK_MENU_COPY, WREN_ICONS } from '@raven/wren'
import { COLORS, type Color, type Size } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'

type LikeButtonProps = {
  /** Whether the song is a favourite, and the press that flips it. */
  like: MenuLike
  /** The song's title, which the heart is named for. */
  title: string
  /** The heart's colour while the song is not a favourite. */
  idleColor: Color
  /** The circle's width; the icon button's own unless the place asks for another. */
  size?: Size
}

/** A song's heart: filled and red while it is a favourite, and said aloud as on or off. */
export function LikeButton({ like, title, idleColor, size }: LikeButtonProps) {
  return (
    <IconButton
      color={like.isLiked ? COLORS.accentText : idleColor}
      icon={like.isLiked ? WREN_ICONS.heartFilled : WREN_ICONS.heart}
      isSelected={like.isLiked}
      label={TRACK_MENU_COPY.likeSong(title)}
      onPress={like.onToggle}
      size={size}
    />
  )
}
