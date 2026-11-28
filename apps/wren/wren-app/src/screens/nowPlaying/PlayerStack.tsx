import { type SongActions, TRANSPORTS } from '@raven/wren'
import { ScrollView, useWindowDimensions } from 'react-native'

import { SCRUBBERS, Scrubber } from '@/player/Scrubber'
import { Transport } from '@/player/Transport'
import { PlayerCover } from '@/screens/nowPlaying/PlayerCover'
import { PlayerExtras } from '@/screens/nowPlaying/PlayerExtras'
import { SongTitle } from '@/screens/nowPlaying/SongTitle'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { themedStyles } from '@/theme/wrenTheme'
import { PLAYER_SIZES, SPACE } from '@/theme/wrenTokens'

// The share of the window's height the cover may take, so a short phone still fits the controls.
const ART_HEIGHT_SHARE = 0.4

const useStyles = themedStyles(() => ({
  pane: { flex: 1 },
  player: {
    flexGrow: 1,
    gap: SPACE.s5,
    justifyContent: 'center',
    paddingHorizontal: PLAYER_SIZES.gutter,
    paddingVertical: SPACE.s5,
  },
}))

type PlayerStackProps = {
  playing: Playing
  actions: SongActions
  /** The width it is given: the phone's window, or the tablet's player column. */
  width: number
}

/**
 * The player, as the phone's player pane and the tablet's first column draw it: the cover
 * large, the song with its heart and Add to playlist, the scrubber over its times, Previous,
 * Play or Pause and Next, the volume and a book's speed. It scrolls when a short window cannot
 * hold it.
 */
export function PlayerStack({ playing, actions, width }: PlayerStackProps) {
  const styles = useStyles()
  const { height } = useWindowDimensions()
  const artSize = Math.min(
    width - 2 * PLAYER_SIZES.gutter,
    PLAYER_SIZES.art,
    height * ART_HEIGHT_SHARE,
  )
  return (
    <ScrollView contentContainerStyle={styles.player} style={styles.pane}>
      <PlayerCover cover={playing.cover} size={artSize} track={playing.track} />
      <SongTitle like={actions.like} onAddToPlaylist={actions.onAddToPlaylist} playing={playing} />
      <Scrubber kind={SCRUBBERS.player} length={playing.length} />
      <Transport kind={TRANSPORTS.player} />
      <PlayerExtras isAudiobook={playing.isAudiobook} />
    </ScrollView>
  )
}
