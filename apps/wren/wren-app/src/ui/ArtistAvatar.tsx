import { Image, StyleSheet, Text, View } from 'react-native'

import type { Cover } from '@/music/useCovers'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { FONTS, RADIUS, SIZE } from '@/theme/wrenTokens'

// The initial is set at this share of the circle.
const INITIAL_SHARE = 0.42

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: { color: colors.text2, fontFamily: FONTS.display },
}))

type ArtistAvatarProps = {
  name: string
  size?: number
  /** Its corners, where it is no circle: an artist's card rounds a square. */
  radius?: number
  /** The artist's picture, or null until the server has one, when the initial stands alone. */
  picture: Cover | null
}

/** An artist's circle: their picture, or their initial in Young Serif. Decorative beside their name. */
export function ArtistAvatar({
  name,
  size = SIZE.avatar,
  radius = RADIUS.pill,
  picture,
}: ArtistAvatarProps) {
  const styles = useStyles()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: size, height: size, borderRadius: radius }]}
    >
      <Text style={[styles.initial, { fontSize: size * INITIAL_SHARE }]}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
      {picture !== null && (
        <Image accessibilityIgnoresInvertColors source={picture} style={StyleSheet.absoluteFill} />
      )}
    </View>
  )
}
