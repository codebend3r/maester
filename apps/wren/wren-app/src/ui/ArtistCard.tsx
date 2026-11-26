import type { Artist } from '@raven/core'
import { countsLineOf } from '@raven/wren'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { type ArtistPhotoOf } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
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
  artist: Artist
  photoOf: ArtistPhotoOf
  /** The column's width, which a grid works out. */
  width: number
}

/**
 * An artist in a grid, as raven's Artists tab draws one: their photo, or their initial, beside
 * their name in the display face and what they hold under it, the zeros left out. A press opens
 * their page.
 */
export function ArtistCard({ artist, photoOf, width }: ArtistCardProps) {
  const styles = useStyles()
  const router = useRouter()
  const counts = countsLineOf({ albums: artist.albumCount, tracks: artist.trackCount })
  return (
    <Pressable
      accessibilityLabel={artist.name}
      accessibilityRole="button"
      onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))}
      style={pressedStyleOf({ style: { width } })}
    >
      <Card style={styles.card}>
        <ArtistAvatar
          name={artist.name}
          picture={photoOf(artist)}
          radius={RADIUS.md}
          size={SIZE.artistPhoto}
        />
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.name}>
            {artist.name}
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
