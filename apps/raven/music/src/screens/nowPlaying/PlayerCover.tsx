import { View } from 'react-native'

import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { themedStyles } from '@/theme/wrenTheme'
import { RADIUS } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'

const useStyles = themedStyles(() => ({ cover: { alignSelf: 'center' } }))

type PlayerCoverProps = {
  cover: Playing['cover']
  /** The cover's side, which the layout fits to its column. */
  size: number
}

/** The playing song's cover, large and raised, in the middle of its column. */
export function PlayerCover({ cover, size }: PlayerCoverProps) {
  const styles = useStyles()
  return (
    <View style={styles.cover}>
      <AlbumArt cover={cover} isRaised radius={RADIUS.art} size={size} />
    </View>
  )
}
