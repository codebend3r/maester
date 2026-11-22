import { countsLineOf } from '@raven/wren'
import { Pressable, Text, View } from 'react-native'

import type { Cover } from '@/music/useCovers'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { ArtistAvatar } from '@/ui/ArtistAvatar'
import { Card } from '@/ui/Card'
import { pressedStyleOf } from '@/ui/press'

/** How tall a card stands: its photo inside its padding and ring, so a grid of them scrolls by arithmetic. */
export const ARTIST_CARD_HEIGHT = SIZE.artistPhoto + 2 * SPACE.s2 + 2 * SIZE.hairline

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    height: ARTIST_CARD_HEIGHT,
    padding: SPACE.s2,
  },
  text: { flex: 1, gap: SPACE.s1 },
  name: { ...TYPE.cardTitle, color: colors.text },
  counts: { ...TYPE.meta, color: colors.text2 },
}))

type ArtistCardProps = {
  name: string
  albumCount: number
  trackCount: number
  picture: Cover | null
  /** The column's width, which a grid works out. */
  width: number
  onPress: () => void
}

/**
 * An artist in a grid, as raven's Artists tab draws one: their photo, or their initial, beside
 * their name in the display face and what they hold under it, the zeros left out.
 */
export function ArtistCard({
  name,
  albumCount,
  trackCount,
  picture,
  width,
  onPress,
}: ArtistCardProps) {
  const styles = useStyles()
  const counts = countsLineOf({ albums: albumCount, tracks: trackCount })
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityRole="button"
      onPress={onPress}
      style={pressedStyleOf({ style: { width } })}
    >
      <Card style={styles.card}>
        <ArtistAvatar name={name} picture={picture} radius={RADIUS.md} size={SIZE.artistPhoto} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {counts !== '' && (
            <Text numberOfLines={1} style={styles.counts}>
              {counts}
            </Text>
          )}
        </View>
      </Card>
    </Pressable>
  )
}
