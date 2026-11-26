import type { Track } from '@raven/core'
import {
  playingTrackOf,
  useAudioQueue,
  KeyedView,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import {
  MENU_VIEWS,
  type MenuView,
  NOW_PLAYING_COPY,
  PANES,
  SIDE_PANE_CHOICES,
  type SidePane,
  type SongActions,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { Text, TVFocusGuideView, View } from 'react-native'
import { useTrackLike, type WrenSession, useWren } from '@raven/wren-native'

import { TrackMenu } from '@/components/TracksMenu'
import { LyricsView } from '@/screens/nowPlaying/LyricsView'
import { PlayerColumn } from '@/screens/nowPlaying/PlayerColumn'
import { UpNext } from '@/screens/nowPlaying/UpNext'
import { type Playing, usePlaying } from '@/screens/nowPlaying/usePlaying'
import { RADIUS, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { ChoiceRow } from '@/ui/ChoiceRow'
import { FOCUS_ROLES } from '@/ui/Focusable'

const useStyles = themedStyles(({ colors }) => ({
  screen: {
    backgroundColor: colors.bg,
    flex: 1,
    flexDirection: 'row',
    gap: SPACE.s8,
    padding: SPACE.gutter,
  },
  side: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    flex: 1,
    gap: SPACE.s4,
    padding: SPACE.s6,
  },
  idle: { alignItems: 'center', backgroundColor: colors.bg, flex: 1, justifyContent: 'center' },
  idleText: { ...TYPE.body, color: colors.text2 },
}))

type SidePaneProps = { playing: Playing }

/** What plays next, under what changes the queue: Shuffle, Repeat and Clear. */
function UpNextPane({ playing }: SidePaneProps) {
  return <UpNext session={playing.session} sourceName={playing.title.sourceName} />
}

/** The song's words. */
function LyricsPane({ playing }: SidePaneProps) {
  return <LyricsView lyrics={playing.lyrics} />
}

const SIDE_PANE_VIEWS = {
  [PANES.upNext]: UpNextPane,
  [PANES.lyrics]: LyricsPane,
} as const satisfies Record<SidePane, ComponentType<SidePaneProps>>

type PlayerLayoutProps = { playing: Playing; actions: SongActions }

/**
 * The tablet's sideways Now Playing, the whole TV in two columns: the player, and one pane of
 * two tabs, Up next (which it opens on) and Lyrics.
 */
function PlayerLayout({ playing, actions }: PlayerLayoutProps) {
  const styles = useStyles()
  const [pane, setPane] = useState<SidePane>(SIDE_PANE_CHOICES[0].key)
  const PaneView = SIDE_PANE_VIEWS[pane]
  return (
    <View style={styles.screen}>
      <PlayerColumn actions={actions} playing={playing} />
      <TVFocusGuideView autoFocus style={styles.side}>
        <ChoiceRow
          choices={SIDE_PANE_CHOICES}
          label={NOW_PLAYING_COPY.sidePanes}
          onSelect={setPane}
          role={FOCUS_ROLES.tab}
          selected={pane}
        />
        <PaneView playing={playing} />
      </TVFocusGuideView>
    </View>
  )
}

/** Whether a song is queued for Now Playing to show. */
const SCREEN_STATES = { idle: 'idle', playing: 'playing' } as const

type ScreenState = (typeof SCREEN_STATES)[keyof typeof SCREEN_STATES]

/** What Now Playing shows: nothing queued, or the song that plays. */
type Shown =
  | { state: typeof SCREEN_STATES.idle }
  | { state: typeof SCREEN_STATES.playing; track: Track }

type ShownViewProps<K extends ScreenState> = { session: WrenSession; shown: Shown & { state: K } }

/**
 * A song is queued: the player beside its pane, and the song's menu over it, opened on its
 * actions from More or on the listener's playlists from Add to playlist.
 */
function PlayingView({ session, shown: { track } }: ShownViewProps<typeof SCREEN_STATES.playing>) {
  const playing = usePlaying({ session, track })
  const like = useTrackLike({ session, track })
  const [menu, setMenu] = useState<MenuView | null>(null)
  return (
    <>
      <PlayerLayout
        actions={{
          like,
          onAddToPlaylist: () => setMenu(MENU_VIEWS.playlists),
          onMore: () => setMenu(MENU_VIEWS.actions),
        }}
        playing={playing}
      />
      {menu !== null && (
        <TrackMenu like={like} onClose={() => setMenu(null)} startsOn={menu} track={track} />
      )}
    </>
  )
}

/** Nothing is queued: that nothing plays. Back leaves, as from every page. */
function IdleView() {
  const styles = useStyles()
  return (
    <View style={styles.idle}>
      <Text style={styles.idleText}>{NOW_PLAYING_COPY.nothing}</Text>
    </View>
  )
}

/** Each state's view props, or only `Keys`' for a builder generic over the state. */
type ShownProps<Keys extends ScreenState = ScreenState> = { [K in Keys]: ShownViewProps<K> }

const SHOWN_VIEWS = {
  [SCREEN_STATES.idle]: IdleView,
  [SCREEN_STATES.playing]: PlayingView,
} as const satisfies ViewsOf<ShownProps>

/** What shows as its state's view, so each view is handed its own state. */
const shownViewOf = <K extends ScreenState>({
  session,
  shown,
}: ShownViewProps<K>): ViewOf<ShownProps<K>, K> => ({ key: shown.state, props: { session, shown } })

type NowPlayingScreenProps = { session: WrenSession }

function NowPlayingScreen({ session }: NowPlayingScreenProps) {
  const track = useAudioQueue(playingTrackOf)
  const shown: Shown =
    track === null ? { state: SCREEN_STATES.idle } : { state: SCREEN_STATES.playing, track }
  return <KeyedView<ShownProps> view={shownViewOf({ session, shown })} views={SHOWN_VIEWS} />
}

/**
 * `/now-playing`, the player opened up across the TV: where the queue plays from, the cover
 * large, the song with its heart, Add to playlist and More, what it plays as, the scrubber the
 * remote's left and right step, Previous, Play or Pause and Next with Shuffle and Repeat; and
 * beside it one pane of Up next (Shuffle, Repeat and Clear over the songs, each playable, moved
 * or taken off through its More) or Lyrics (a synced line plays from where it is sung). Back,
 * or Menu on Apple TV, closes it.
 */
export function NowPlaying() {
  const session = useWren()
  return session !== null && <NowPlayingScreen key={session.server.id} session={session} />
}
