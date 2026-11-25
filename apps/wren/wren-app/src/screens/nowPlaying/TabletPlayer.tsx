import {
  NOW_PLAYING_COPY,
  PANES,
  SIDE_PANE_CHOICES,
  type SidePane,
  type SongActions,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LyricsView } from '@/screens/nowPlaying/LyricsView'
import { PlayerHeader } from '@/screens/nowPlaying/PlayerHeader'
import { PlayerStack } from '@/screens/nowPlaying/PlayerStack'
import { UP_NEXT_PLACES, UpNext } from '@/screens/nowPlaying/UpNext'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { PLAYER_SIZES, RADIUS, SHELL_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

/** The player column's share of the screen's width; the pane of Up next and Lyrics takes the rest. */
const PLAYER_COLUMN_SHARE = 0.4

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  screen: { backgroundColor: colors.bg, flex: 1, flexDirection: 'row' },
  player: {
    alignItems: 'center',
    borderRightColor: colors.line,
    borderRightWidth: SIZE.hairline,
    paddingTop: SPACE.s2,
  },
  // The header over the player, kept together in the middle of a column wider than they need.
  column: { flex: 1, maxWidth: PLAYER_SIZES.column, width: '100%' },
  header: { paddingHorizontal: SPACE.s3 },
  side: {
    backgroundColor: colors.surface,
    flex: 1,
    gap: SPACE.s4,
    paddingHorizontal: SHELL_SIZES.tabletPadSide,
    paddingTop: SPACE.s4,
  },
  sideHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s4,
    justifyContent: 'space-between',
  },
  // The tabs, as wide as the player's own column at most.
  tabs: { flex: 1, maxWidth: PLAYER_SIZES.column },
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

type SidePaneProps = { playing: Playing }

/** What plays next, under what changes the queue: Shuffle, Repeat and Clear. */
function UpNextTab({ playing }: SidePaneProps) {
  return (
    <UpNext
      place={UP_NEXT_PLACES.panel}
      session={playing.session}
      sourceName={playing.title.sourceName}
    />
  )
}

/** The song's words. */
function LyricsTab({ playing }: SidePaneProps) {
  return <LyricsView lyrics={playing.lyrics} />
}

const SIDE_PANE_VIEWS = {
  [PANES.upNext]: UpNextTab,
  [PANES.lyrics]: LyricsTab,
} as const satisfies Record<SidePane, ComponentType<SidePaneProps>>

type TabletPlayerProps = { playing: Playing; actions: SongActions }

/**
 * The tablet's Now Playing, the whole screen in two columns. The first is the player, as the
 * phone draws it: the header, the cover, the song, the scrubber, the transport and the volume.
 * The second is one pane of two tabs, Up next (which it opens on) and Lyrics, under where the
 * music plays.
 */
export function TabletPlayer({ playing, actions }: TabletPlayerProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { width } = useWindowDimensions()
  const { top, bottom } = useSafeAreaInsets()
  const [pane, setPane] = useState<SidePane>(SIDE_PANE_CHOICES[0].key)
  const PaneView = SIDE_PANE_VIEWS[pane]
  const playerWidth = width * PLAYER_COLUMN_SHARE
  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <View style={[styles.player, { width: playerWidth, paddingBottom: bottom }]}>
        <View style={styles.column}>
          <View style={styles.header}>
            <PlayerHeader onClose={playing.close} onMore={actions.onMore} title={playing.title} />
          </View>
          <PlayerStack
            actions={actions}
            playing={playing}
            width={Math.min(playerWidth, PLAYER_SIZES.column)}
          />
        </View>
      </View>
      <View style={[styles.side, { paddingBottom: bottom }]}>
        <View style={styles.sideHead}>
          <View style={styles.tabs}>
            <SegmentedControl
              choices={SIDE_PANE_CHOICES}
              label={NOW_PLAYING_COPY.sidePanes}
              onSelect={setPane}
              selected={pane}
            />
          </View>
          <View accessible style={styles.output}>
            <WrenIcon color={colors.text2} name={ICONS.output} size={SIZE.smallIcon} />
            <Text numberOfLines={1} style={styles.outputText}>
              {playing.playingOn}
            </Text>
          </View>
        </View>
        <PaneView playing={playing} />
      </View>
    </View>
  )
}
