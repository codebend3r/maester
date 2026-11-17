import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LyricsView } from '@/screens/nowPlaying/LyricsView'
import { HEADER_TITLES, PlayerHeader } from '@/screens/nowPlaying/PlayerHeader'
import { PlayerStack } from '@/screens/nowPlaying/PlayerStack'
import { UP_NEXT_PLACES, UpNext } from '@/screens/nowPlaying/UpNext'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { PLAYER_SIZES, RADIUS, SHELL_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import { PLAYER_COPY } from '@/ui/copy'

/*
 * The player's and the panel's shares of the window, at most their designed widths, so a
 * smaller tablet keeps room for the lyrics between them.
 */
const COLUMN_SHARES = { player: 0.36, panel: 0.285 } as const

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  screen: { backgroundColor: colors.bg, flex: 1, flexDirection: 'row' },
  player: { borderRightColor: colors.line, borderRightWidth: SIZE.hairline },
  playerContent: {
    gap: SPACE.s5,
    paddingBottom: SHELL_SIZES.tabletPadTop,
    paddingHorizontal: SHELL_SIZES.tabletPadSide,
  },
  header: { marginHorizontal: -SPACE.s3 },
  lyrics: { flex: 1, gap: SPACE.s5, paddingHorizontal: SHELL_SIZES.tabletPadSide + SPACE.s2 },
  overline: { ...TYPE.overline, color: colors.text3 },
  panel: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.line,
    borderLeftWidth: SIZE.hairline,
    gap: SPACE.s4,
    paddingHorizontal: PLAYER_SIZES.gutter,
  },
  output: {
    alignItems: 'center',
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.field,
    paddingHorizontal: SPACE.s4,
  },
  outputText: { ...TYPE.body, color: colors.text2, flex: 1 },
}))

type TabletPlayerProps = { playing: Playing; onMore: () => void }

/**
 * The tablet's Now Playing, the whole screen in three columns: the player (the cover, the song
 * and the transport), the lyrics in the middle, and Up next on a panel at the right with where
 * the music plays at its foot.
 */
export function TabletPlayer({ playing, onMore }: TabletPlayerProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { width } = useWindowDimensions()
  const { top, bottom } = useSafeAreaInsets()
  const { session, title } = playing
  const playerWidth = Math.min(PLAYER_SIZES.tabletColumn, width * COLUMN_SHARES.player)
  const panelWidth = Math.min(PLAYER_SIZES.tabletQueuePanel, width * COLUMN_SHARES.panel)
  const art = Math.min(PLAYER_SIZES.tabletArt, playerWidth - 2 * SHELL_SIZES.tabletPadSide)
  const edges = {
    paddingTop: top + SHELL_SIZES.tabletPadTop,
    paddingBottom: bottom + SHELL_SIZES.tabletPadTop,
  }
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.playerContent, { paddingTop: top + SPACE.s6 }]}
        style={[styles.player, { width: playerWidth }]}
      >
        <View style={styles.header}>
          <PlayerHeader
            onClose={playing.close}
            onMore={onMore}
            title={title}
            variant={HEADER_TITLES.short}
          />
        </View>
        <PlayerStack artSize={art} playing={playing} />
      </ScrollView>
      <View style={[styles.lyrics, edges]}>
        <Text accessibilityRole="header" style={styles.overline}>
          {PLAYER_COPY.lyrics}
        </Text>
        <LyricsView lyrics={playing.lyrics} />
      </View>
      <View style={[styles.panel, edges, { width: panelWidth }]}>
        <UpNext place={UP_NEXT_PLACES.panel} session={session} sourceName={title.sourceName} />
        <View accessible style={styles.output}>
          <WrenIcon color={colors.text2} name={ICONS.output} size={SIZE.smallIcon} />
          <Text numberOfLines={1} style={styles.outputText}>
            {playing.playingOn}
          </Text>
        </View>
      </View>
    </View>
  )
}
