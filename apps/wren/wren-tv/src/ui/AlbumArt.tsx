import { Image, StyleSheet, View } from 'react-native'

import { type Cover } from '@raven/wren-native'
import { RADIUS } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

// The fallback's note is drawn at this share of the square.
const NOTE_SHARE = 0.4

const useStyles = themedStyles(({ colors }) => ({
  art: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
}))

type AlbumArtProps = {
  /** The server's cover, or null for an album that has none. */
  cover: Cover | null
  size: number
  /** A round picture, an artist's, where an album's is square. */
  isRound?: boolean
  radius?: number
}

/**
 * An album's cover, or an artist's photo, at `size`. Under it, and in its place when there is
 * none, a quiet square with a note, so a picture still on its way never leaves a hole.
 */
export function AlbumArt({ cover, size, isRound = false, radius = RADIUS.item }: AlbumArtProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const borderRadius = isRound ? size / 2 : radius
  return (
    <View style={[styles.art, { width: size, height: size, borderRadius }]}>
      <WrenIcon
        color={colors.text3}
        name={isRound ? ICONS.artist : ICONS.song}
        size={size * NOTE_SHARE}
      />
      {cover !== null && (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={cover}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  )
}
