import { type MenuLike, TRACK_MENU_COPY } from '@raven/wren'
import { COLORS } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS } from '@/ui/WrenIcon/icons'

type LikeButtonProps = {
  /** Whether the song is a favourite, and the press that flips it. */
  like: MenuLike
  /** The song's title, which the heart is named for. */
  title: string
}

/** A song's heart: filled and red while it is a favourite, and said aloud as on or off. */
export function LikeButton({ like, title }: LikeButtonProps) {
  return (
    <IconButton
      color={like.isLiked ? COLORS.accentText : COLORS.text2}
      icon={like.isLiked ? ICONS.heartFilled : ICONS.heart}
      isSelected={like.isLiked}
      label={TRACK_MENU_COPY.likeSong(title)}
      onPress={like.onToggle}
    />
  )
}
