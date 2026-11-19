import { View } from 'react-native'

import { SCRUBBERS, Scrubber } from '@/player/Scrubber'
import { TRANSPORTS, Transport } from '@/player/Transport'
import { PlayerExtras } from '@/screens/nowPlaying/PlayerExtras'
import { SongTitle } from '@/screens/nowPlaying/SongTitle'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { themedStyles } from '@/theme/wrenTheme'
import { RADIUS } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'

const useStyles = themedStyles(() => ({ art: { alignSelf: 'center' } }))

type PlayerStackProps = {
  playing: Playing
  /** The cover's side, which the layout fits to its column. */
  artSize: number
}

/**
 * The player, as the phone's player pane draws it: the cover large, the song, the scrubber, the
 * transport, the volume and a book's speed.
 */
export function PlayerStack({ playing, artSize }: PlayerStackProps) {
  const styles = useStyles()
  return (
    <>
      <View style={styles.art}>
        <AlbumArt cover={playing.cover} isRaised radius={RADIUS.art} size={artSize} />
      </View>
      <SongTitle playing={playing} />
      <Scrubber kind={SCRUBBERS.player} length={playing.length} />
      <Transport kind={TRANSPORTS.player} />
      <PlayerExtras isAudiobook={playing.isAudiobook} />
    </>
  )
}
