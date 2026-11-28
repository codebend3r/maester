import { COVER_MENU_COPY } from '@raven/wren'
import { useState } from 'react'
import { Pressable } from 'react-native'

import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { themedStyles } from '@/theme/wrenTheme'
import { RADIUS } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { TrackCoverMenu } from '@/ui/CoverMenu'
import { coverHoldPropsOf } from '@/ui/HeldArt'
import { pressedStyleOf } from '@/ui/press'

const useStyles = themedStyles(() => ({ cover: { alignSelf: 'center' } }))

type PlayerCoverProps = Pick<Playing, 'cover' | 'track'> & {
  /** The cover's side, which the layout fits to its column. */
  size: number
}

/**
 * The playing song's cover, large and raised, in the middle of its column. Held, or through the
 * screen reader's long press, it opens the song's cover menu: what it is, Go to album and Go to
 * artist.
 */
export function PlayerCover({ cover, track, size }: PlayerCoverProps) {
  const styles = useStyles()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const openMenu = () => setIsMenuOpen(true)
  return (
    <Pressable
      {...coverHoldPropsOf(openMenu)}
      accessibilityLabel={COVER_MENU_COPY.cover(track.title)}
      accessibilityRole="image"
      onLongPress={openMenu}
      style={pressedStyleOf({ style: styles.cover })}
    >
      <AlbumArt cover={cover} isRaised radius={RADIUS.art} size={size} />
      {isMenuOpen && <TrackCoverMenu onClose={() => setIsMenuOpen(false)} track={track} />}
    </Pressable>
  )
}
