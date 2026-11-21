import type { Track } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { NOW_PLAYING_COPY } from '@raven/wren'
import { TrackMenu } from '@/components/TrackMenu'
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
 * The layout for the screen: the tablet's two rows on a tablet held sideways, the phone's panes
 * otherwise, since an upright tablet's player column would be too narrow for the transport.
 */
const usePlayerFormFactor = (): FormFactor => {
  const formFactor = useFormFactor()
  const isPortrait = useIsPortrait()
  return isPortrait ? FORM_FACTORS.phone : formFactor
}

/** Whether a song is queued for the sheet to show. */
const SHEET_STATES = { idle: 'idle', playing: 'playing' } as const

type SheetState = (typeof SHEET_STATES)[keyof typeof SHEET_STATES]

/** What the sheet shows: nothing queued, or the song that plays. */
type Sheet =
  | { state: typeof SHEET_STATES.idle }
  | { state: typeof SHEET_STATES.playing; track: Track }

type SheetViewProps<K extends SheetState> = { session: WrenSession; sheet: Sheet & { state: K } }

/** A song is queued: the layout for the screen, and the song's actions over it from More. */
function PlayingSheet({ session, sheet: { track } }: SheetViewProps<typeof SHEET_STATES.playing>) {
  const playing = usePlaying({ session, track })
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const Layout = LAYOUT_VIEWS[usePlayerFormFactor()]
  return (
    <>
      <Layout onMore={() => setIsMenuOpen(true)} playing={playing} />
      {isMenuOpen && <TrackMenu onClose={() => setIsMenuOpen(false)} track={track} />}
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

type SheetViews = { [K in SheetState]: ComponentType<SheetViewProps<K>> }

const SHEET_VIEWS = {
  [SHEET_STATES.idle]: IdleSheet,
  [SHEET_STATES.playing]: PlayingSheet,
} as const satisfies SheetViews

// Typed as the mapped type, so a state looks up the view that takes that state's sheet.
const SHEETS: SheetViews = SHEET_VIEWS

function SheetView<K extends SheetState>({ session, sheet }: SheetViewProps<K>) {
  const Shown: ComponentType<SheetViewProps<K>> = SHEETS[sheet.state]
  return <Shown session={session} sheet={sheet} />
}

type NowPlayingSheetProps = { session: WrenSession }

function NowPlayingSheet({ session }: NowPlayingSheetProps) {
  const track = useAudioQueue(playingTrackOf)
  const sheet: Sheet =
    track === null ? { state: SHEET_STATES.idle } : { state: SHEET_STATES.playing, track }
  return <SheetView session={session} sheet={sheet} />
}

/**
 * `/now-playing`, the player opened up. On a phone: the cover large, the song, the scrubber and
 * the transport, with a bar at the foot for the lyrics (a synced line plays from where it is
 * sung) and Up next (each song playable, dragged to another place or swiped away). On a tablet
 * held sideways, the cover and the controls beside the lyrics, over Up next across the foot.
 */
export function NowPlaying() {
  const session = useWren()
  return session !== null && <NowPlayingSheet key={session.server.id} session={session} />
}
