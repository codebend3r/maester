import { WREN_ICONS } from '@raven/wren'
import { Image, StyleSheet, View } from 'react-native'

import { type Cover } from '@raven/wren-native'
import { type WrenTheme, themedStyles, useWrenTheme, shadowOf } from '@/theme/wrenTheme'
import { RADIUS, SHADOWS } from '@/theme/wrenTokens'
import { WrenIcon } from '@/ui/WrenIcon'

// The fallback's note is drawn at this share of the square.
const NOTE_SHARE = 0.4

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  art: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // A raised cover lifts off the ground on a soft shadow its clipped square cannot cast itself.
  raised: {
    backgroundColor: colors.bg,
    ...shadowOf({ shadow: SHADOWS.raised, color: colors.shadow }),
  },
}))

type AlbumArtProps = {
  /** The server's cover, or null for an album that has none. */
  cover: Cover | null
  size: number
  radius?: number
  /** Whether it is a page's large cover, lifted off the ground on a soft shadow. */
  isRaised?: boolean
}

/**
 * An album's cover, square at `size`. Under it, and in its place when there is none, a quiet
 * square with a note, so a cover still on its way never leaves a hole.
 */
export function AlbumArt({ cover, size, radius = RADIUS.sm, isRaised = false }: AlbumArtProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={isRaised && [styles.raised, { borderRadius: radius }]}>
      <View style={[styles.art, { width: size, height: size, borderRadius: radius }]}>
        <WrenIcon color={colors.text3} name={WREN_ICONS.song} size={size * NOTE_SHARE} />
        {cover !== null && (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={cover}
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
    </View>
  )
}
