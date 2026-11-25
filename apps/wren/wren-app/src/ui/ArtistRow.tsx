import { Pressable, Text, View } from 'react-native'

import { countsLineOf } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { ArtistAvatar } from '@/ui/ArtistAvatar'
import { pressedStyleOf } from '@/ui/press'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s4,
    minHeight: SIZE.artistRow,
  },
  text: { flex: 1 },
  name: { ...TYPE.rowTitle, color: colors.text },
  counts: { ...TYPE.meta, color: colors.text2 },
}))

type ArtistRowProps = {
  name: string
  albumCount: number
  trackCount: number
  picture: Cover | null
  onPress: () => void
}

/** An artist in a list: their circle, their name, and what they hold with the zeros left out. */
export function ArtistRow({ name, albumCount, trackCount, picture, onPress }: ArtistRowProps) {
  const styles = useStyles()
  const counts = countsLineOf({ albums: albumCount, tracks: trackCount })
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityRole="button"
      onPress={onPress}
      style={pressedStyleOf({ style: styles.row })}
    >
      <ArtistAvatar name={name} picture={picture} />
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
    </Pressable>
  )
}
