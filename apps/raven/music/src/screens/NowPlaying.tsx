import type { Track } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MENU_VIEWS, type MenuView, TrackMenu } from '@/components/TrackMenu'
import { NOW_PLAYING_COPY } from '@/screens/copy'
import { PhonePlayer } from '@/screens/nowPlaying/PhonePlayer'
import { CloseButton } from '@/screens/nowPlaying/PlayerHeader'
import { TabletPlayer } from '@/screens/nowPlaying/TabletPlayer'
import { type Playing, usePlaying } from '@/screens/nowPlaying/usePlaying'
import { type WrenTheme, themedStyles, useFormFactor, useIsPortrait } from '@/theme/wrenTheme'
import { SPACE, TYPE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { type WrenSession, useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  idle: { backgroundColor: colors.bg, flex: 1, paddingHorizontal: SPACE.s3 },
  idleBody: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  idleText: { ...TYPE.body, color: colors.text2 },
}))

type LayoutProps = { playing: Playing; onMore: () => void }

const LAYOUT_VIEWS = {
  [FORM_FACTORS.phone]: PhonePlayer,
  [FORM_FACTORS.tablet]: TabletPlayer,
} as const satisfies Record<FormFactor, ComponentType<LayoutProps>>

/**
 * The layout for the screen: the three columns on a tablet held sideways, the phone's panes
 * otherwise, since an upright tablet has too little width for three.
 */
const usePlayerFormFactor = (): FormFactor => {
  const formFactor = useFormFactor()
  const isPortrait = useIsPortrait()
  return isPortrait ? FORM_FACTORS.phone : formFactor
}

type PlayingSheetProps = { session: WrenSession; track: Track }

/** A song is queued: the layout for the screen, and the song's actions over it from More. */
function PlayingSheet({ session, track }: PlayingSheetProps) {
  const playing = usePlaying({ session, track })
  const [menu, setMenu] = useState<MenuView | null>(null)
  const Layout = LAYOUT_VIEWS[usePlayerFormFactor()]
  return (
    <>
      <Layout onMore={() => setMenu(MENU_VIEWS.actions)} playing={playing} />
      {menu !== null && <TrackMenu onView={setMenu} track={track} view={menu} />}
    </>
  )
}

/** Nothing is queued: the way down, and that nothing plays. */
function IdleSheet() {
  const styles = useStyles()
  const router = useRouter()
  const { top } = useSafeAreaInsets()
  return (
    <View style={[styles.idle, { paddingTop: top + SPACE.s2 }]}>
      <CloseButton onClose={() => router.back()} />
      <View style={styles.idleBody}>
        <Text style={styles.idleText}>{NOW_PLAYING_COPY.nothing}</Text>
      </View>
    </View>
  )
}

/** Whether a song is queued for the sheet to show. */
const SHEET_STATES = { idle: 'idle', playing: 'playing' } as const

type SheetState = (typeof SHEET_STATES)[keyof typeof SHEET_STATES]

type SheetViewProps = { session: WrenSession; track: Track | null }

function QueuedSheet({ session, track }: SheetViewProps) {
  return track !== null && <PlayingSheet session={session} track={track} />
}

const SHEET_VIEWS = {
  [SHEET_STATES.idle]: IdleSheet,
  [SHEET_STATES.playing]: QueuedSheet,
} as const satisfies Record<SheetState, ComponentType<SheetViewProps>>

type NowPlayingSheetProps = { session: WrenSession }

function NowPlayingSheet({ session }: NowPlayingSheetProps) {
  const track = useAudioQueue(playingTrackOf)
  const Sheet = SHEET_VIEWS[track === null ? SHEET_STATES.idle : SHEET_STATES.playing]
  return <Sheet session={session} track={track} />
}

/**
 * `/now-playing`, the player opened up. On a phone: the cover large, the song, the scrubber and
 * the transport, with a bar at the foot for the lyrics (a synced line plays from where it is
 * sung) and Up next (each song playable, dragged to another place or swiped away). On a tablet
 * held sideways, the player, the lyrics and Up next side by side.
 */
export function NowPlaying() {
  const session = useWren()
  return session !== null && <NowPlayingSheet key={session.server.id} session={session} />
}
