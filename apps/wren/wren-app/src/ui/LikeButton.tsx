import { type MenuLike, TRACK_MENU_COPY, WREN_ICONS } from '@raven/wren'

import { useWrenTheme } from '@/theme/wrenTheme'
import { IconButton } from '@/ui/IconButton'

type LikeButtonProps = {
  /** Whether the song is a favourite, and the press that flips it. */
  like: MenuLike
  /** The song's title, which the heart is named for. */
  title: string
}

/** A song's heart: filled and red while it is a favourite, and said aloud as on or off. */
export function LikeButton({ like, title }: LikeButtonProps) {
  const { colors } = useWrenTheme()
  return (
    <IconButton
      color={like.isLiked ? colors.accentText : colors.text2}
      icon={like.isLiked ? WREN_ICONS.heartFilled : WREN_ICONS.heart}
      isSelected={like.isLiked}
      label={TRACK_MENU_COPY.likeSong(title)}
      onPress={like.onToggle}
    />
  )
}
