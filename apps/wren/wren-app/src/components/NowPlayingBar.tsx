import type { Track } from '@raven/core'
import { isPlayingOf, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { progressOf } from '@raven/wren'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useNowPlaying, type WrenSession, useWren } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'
import { CHROMES } from '@/shell/chrome'
import { useChrome } from '@/shell/useShell'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SIZE, SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { MiniPlayer } from '@/ui/MiniPlayer'

/** Where a bar is drawn: above the tab bar on a tab, at the foot of a page the stack opened. */
export const BAR_PLACES = { tabs: CHROMES.tabs, page: CHROMES.page } as const

type BarPlace = (typeof BAR_PLACES)[keyof typeof BAR_PLACES]

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  // The card floats on the ground, 10 in from the edges and 8 above what is under it.
  place: {
    backgroundColor: colors.bg,
    paddingBottom: SPACE.s2,
    paddingHorizontal: SIZE.floatInset,
  },
}))

// A tablet has its player bar instead.
const HAS_MINI_PLAYER = {
  [FORM_FACTORS.phone]: true,
  [FORM_FACTORS.tablet]: false,
} as const satisfies Record<FormFactor, boolean>

/*
 * Whether the bar in `place` shows: on a phone, in the place the screen has; never on sign-in
 * or Now Playing, nor on a tablet, which has its player bar.
 */
const useIsBarShown = (place: BarPlace): boolean => {
  const chrome = useChrome()
  return HAS_MINI_PLAYER[useFormFactor()] && chrome === place
}

type TrackBarProps = { session: WrenSession; place: BarPlace; track: Track }

function TrackBar({ session, place, track }: TrackBarProps) {
  const styles = useStyles()
  const router = useRouter()
  const bottom = useSafeAreaInsets().bottom
  const { cover, artists, length, error } = useNowPlaying({ session, track })
  const isPlaying = useAudioQueue(isPlayingOf)
  const position = useAudioQueue((store) => store.position)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  return (
    <View style={[styles.place, place === BAR_PLACES.page && { paddingBottom: bottom + SPACE.s2 }]}>
      <MiniPlayer
        artists={artists}
        cover={cover}
        error={error}
        isPlaying={isPlaying}
        onNext={next}
        onOpen={() => router.push(WREN_ROUTES.nowPlaying)}
        onToggle={toggle}
        progress={progressOf({ position, length })}
        title={track.title}
      />
    </View>
  )
}

type NowPlayingBarProps = { place: BarPlace }

/**
 * The phone's mini player while a track is queued: its cover, title and artists, play or
 * pause and next; tapped or swiped up, it opens Now Playing. One sits above the tab bar and
 * one at the foot of the stack's pages, and only the one for the screen showing draws.
 */
export function NowPlayingBar({ place }: NowPlayingBarProps) {
  const session = useWren()
  const isShown = useIsBarShown(place)
  const track = useAudioQueue(playingTrackOf)
  return (
    session !== null &&
    isShown &&
    track !== null && <TrackBar place={place} session={session} track={track} />
  )
}
