import { PANES, type Pane, TRANSPORTS, paneAfter } from '@raven/wren'
import { type ComponentType, type ReactNode, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SCRUBBERS, Scrubber } from '@/player/Scrubber'
import { Transport } from '@/player/Transport'
import { BottomBar } from '@/screens/nowPlaying/BottomBar'
import { LyricsView } from '@/screens/nowPlaying/LyricsView'
import { PlayerHeader } from '@/screens/nowPlaying/PlayerHeader'
import { PlayerStack } from '@/screens/nowPlaying/PlayerStack'
import { CompactSong } from '@/screens/nowPlaying/SongTitle'
import { UP_NEXT_PLACES, UpNext } from '@/screens/nowPlaying/UpNext'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { PLAYER_SIZES, SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  sheet: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingHorizontal: SPACE.s3 },
  pane: { flex: 1 },
  padded: { paddingHorizontal: PLAYER_SIZES.gutter },
  compact: {
    paddingBottom: SPACE.s3,
    paddingHorizontal: PLAYER_SIZES.gutter,
    paddingTop: SPACE.s4,
  },
  controls: { gap: SPACE.s3, paddingHorizontal: PLAYER_SIZES.gutter, paddingTop: SPACE.s3 },
  bar: { paddingHorizontal: PLAYER_SIZES.gutter, paddingTop: SPACE.s3 },
}))

type PaneProps = { playing: Playing }

type CompactPaneProps = PaneProps & {
  /** What fills the middle: the lyrics, or Up next. */
  body: ReactNode
  /** What sits under it: the scrubber and the transport, or the transport alone. */
  controls: ReactNode
}

/** A pane under the song's compact head, its controls along its foot. */
function CompactPane({ playing, body, controls }: CompactPaneProps) {
  const styles = useStyles()
  return (
    <View style={styles.pane}>
      <View style={styles.compact}>
        <CompactSong playing={playing} />
      </View>
      {body}
      <View style={styles.controls}>{controls}</View>
    </View>
  )
}

/** The lyrics, the scrubber and transport under them. */
function LyricsPane({ playing }: PaneProps) {
  const styles = useStyles()
  return (
    <CompactPane
      body={
        <View style={[styles.pane, styles.padded]}>
          <LyricsView lyrics={playing.lyrics} />
        </View>
      }
      controls={
        <>
          <Scrubber kind={SCRUBBERS.player} length={playing.length} />
          <Transport kind={TRANSPORTS.lyrics} />
        </>
      }
      playing={playing}
    />
  )
}

/** What plays next, the transport under it. */
function UpNextPane({ playing }: PaneProps) {
  return (
    <CompactPane
      body={
        <UpNext
          place={UP_NEXT_PLACES.sheet}
          session={playing.session}
          sourceName={playing.title.sourceName}
        />
      }
      controls={<Transport kind={TRANSPORTS.queue} />}
      playing={playing}
    />
  )
}

const PANE_VIEWS = {
  [PANES.player]: PlayerStack,
  [PANES.lyrics]: LyricsPane,
  [PANES.upNext]: UpNextPane,
} as const satisfies Record<Pane, ComponentType<PaneProps>>

type PhonePlayerProps = { playing: Playing; onMore: () => void }

/**
 * The phone's Now Playing, over everything: the header, the pane picked (the player, the
 * lyrics or Up next) and the bar along the foot that picks it.
 */
export function PhonePlayer({ playing, onMore }: PhonePlayerProps) {
  const styles = useStyles()
  const { top, bottom } = useSafeAreaInsets()
  const [pane, setPane] = useState<Pane>(PANES.player)
  const PaneView = PANE_VIEWS[pane]
  return (
    <View style={[styles.sheet, { paddingTop: top + SPACE.s2, paddingBottom: bottom + SPACE.s2 }]}>
      <View style={styles.header}>
        <PlayerHeader onClose={playing.close} onMore={onMore} title={playing.title} />
      </View>
      <PaneView playing={playing} />
      <View style={styles.bar}>
        <BottomBar
          onPane={(pressed) => setPane(paneAfter({ current: pane, pressed }))}
          output={playing.output}
          pane={pane}
        />
      </View>
    </View>
  )
}
