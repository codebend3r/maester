import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SCRUBBERS, Scrubber } from '@/player/Scrubber'
import { TRANSPORTS, Transport } from '@/player/Transport'
import { LyricsView } from '@/screens/nowPlaying/LyricsView'
import { HEADER_TITLES, PlayerHeader } from '@/screens/nowPlaying/PlayerHeader'
import { PlayerExtras } from '@/screens/nowPlaying/PlayerExtras'
import { SongTitle } from '@/screens/nowPlaying/SongTitle'
import { TABLET_COLUMN_GAP, tabletFitOf } from '@/screens/nowPlaying/tabletFit'
import { UP_NEXT_PLACES, UpNext } from '@/screens/nowPlaying/UpNext'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { PLAYER_SIZES, RADIUS, SHELL_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  screen: { backgroundColor: colors.bg, flex: 1 },
  top: { flexDirection: 'row' },
  player: { borderRightColor: colors.line, borderRightWidth: SIZE.hairline, flexGrow: 0 },
  playerContent: {
    gap: TABLET_COLUMN_GAP,
    paddingHorizontal: PLAYER_SIZES.gutter,
    paddingVertical: TABLET_COLUMN_GAP,
  },
  art: { alignSelf: 'center' },
  lyrics: {
    flex: 1,
    gap: SPACE.s5,
    paddingHorizontal: SHELL_SIZES.tabletPadSide,
    paddingVertical: TABLET_COLUMN_GAP,
  },
  lyricsHead: { alignItems: 'flex-start', flexDirection: 'row', gap: SPACE.s4 },
  song: { flex: 1 },
  upNext: {
    backgroundColor: colors.surface,
    borderTopColor: colors.line,
    borderTopWidth: SIZE.hairline,
    flex: 1,
    paddingHorizontal: SHELL_SIZES.tabletPadSide,
    paddingTop: SPACE.s4,
  },
  output: {
    alignItems: 'center',
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    flexDirection: 'row',
    flexShrink: 1,
    gap: SPACE.s3,
    minHeight: SIZE.touchTarget,
    paddingHorizontal: SPACE.s4,
  },
  outputText: { ...TYPE.body, color: colors.text2, flexShrink: 1 },
}))

type TabletPlayerProps = { playing: Playing; onMore: () => void }

/**
 * The tablet's Now Playing, the whole screen in two rows. The first is two columns: the cover
 * over the controls, icons and lines with no words, in under a third of the width, and beside
 * them the song, where the music plays and the lyrics. The second, the screen's whole width, is
 * Up next: what the album, the playlist or the shuffle plays after this song.
 */
export function TabletPlayer({ playing, onMore }: TabletPlayerProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { width, height } = useWindowDimensions()
  const { top, bottom } = useSafeAreaInsets()
  const { session, title } = playing
  const { topHeight, playerWidth, art } = tabletFitOf({ width, height: height - top - bottom })
  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <View style={[styles.top, { height: topHeight }]}>
        <ScrollView
          contentContainerStyle={styles.playerContent}
          style={[styles.player, { width: playerWidth }]}
        >
          <PlayerHeader
            onClose={playing.close}
            onMore={onMore}
            title={title}
            variant={HEADER_TITLES.none}
          />
          <View style={styles.art}>
            <AlbumArt cover={playing.cover} isRaised radius={RADIUS.art} size={art} />
          </View>
          <Scrubber kind={SCRUBBERS.bare} length={playing.length} />
          <Transport kind={TRANSPORTS.column} />
          <PlayerExtras isAudiobook={playing.isAudiobook} />
        </ScrollView>
        <View style={styles.lyrics}>
          <View style={styles.lyricsHead}>
            <View style={styles.song}>
              <SongTitle playing={playing} />
            </View>
            <View accessible style={styles.output}>
              <WrenIcon color={colors.text2} name={ICONS.output} size={SIZE.smallIcon} />
              <Text numberOfLines={1} style={styles.outputText}>
                {playing.playingOn}
              </Text>
            </View>
          </View>
          <LyricsView lyrics={playing.lyrics} />
        </View>
      </View>
      <View style={[styles.upNext, { paddingBottom: bottom }]}>
        <UpNext place={UP_NEXT_PLACES.panel} session={session} sourceName={title.sourceName} />
      </View>
    </View>
  )
}
