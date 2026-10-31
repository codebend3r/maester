import { type Track, artistNames } from '@raven/core'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter, useSegments } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AlbumArt } from '@/components/AlbumTile'
import { IconButton } from '@/components/Controls'
import { BAR_COPY } from '@/components/copy'
import { useCovers } from '@/music/useCovers'
import { WREN_ROUTES, WREN_SCREENS } from '@/routes'
import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** Where a bar is drawn: above the tab bar on a tab, at the foot of a page the stack opened. */
export const BAR_PLACES = { tabs: 'tabs', page: 'page' } as const

type BarPlace = (typeof BAR_PLACES)[keyof typeof BAR_PLACES]

/** The screens with no bar: sign-in, and Now Playing, which is the bar opened up. */
const BARLESS_SCREENS: ReadonlySet<string> = new Set([WREN_SCREENS.signIn, WREN_SCREENS.nowPlaying])

/** Whether the bar in `place` shows: while a track is queued, in the place the screen has. */
const useIsBarShown = (place: BarPlace): boolean => {
  const [screen = ''] = useSegments()
  const hasTrack = useAudioQueue((store) => playingTrackOf(store) !== null)
  const here = screen === WREN_SCREENS.tabs ? BAR_PLACES.tabs : BAR_PLACES.page
  return hasTrack && here === place && !BARLESS_SCREENS.has(screen)
}

type BarSession = Pick<WrenSession, 'server' | 'api'>

type BarProps = { session: BarSession; place: BarPlace }

type TrackBarProps = BarProps & { track: Track }

function TrackBar({ session, place, track }: TrackBarProps) {
  const router = useRouter()
  const coverOf = useCovers(session)
  const bottom = useSafeAreaInsets().bottom
  const state = useAudioQueue((store) => store.state)
  const error = useAudioQueue((store) => store.error)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  const artists = artistNames(track)
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  return (
    <View style={[styles.bar, place === BAR_PLACES.page && { paddingBottom: bottom }]}>
      <Pressable
        accessibilityLabel={BAR_COPY.open({ title: track.title, artists })}
        accessibilityRole="button"
        onPress={() => router.push(WREN_ROUTES.nowPlaying)}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <AlbumArt
          cover={coverOf({ albumId: track.albumId, coverVersion: track.album.coverVersion })}
          size={SIZES.fieldHeight}
        />
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.title}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={error === null ? styles.line : styles.error}>
            {error ?? artists}
          </Text>
        </View>
      </Pressable>
      <IconButton
        icon={isPlaying ? WREN_ICONS.pause : WREN_ICONS.play}
        label={isPlaying ? BAR_COPY.pause : BAR_COPY.play}
        onPress={toggle}
      />
      <IconButton icon={WREN_ICONS.next} label={BAR_COPY.next} onPress={next} />
    </View>
  )
}

function Bar({ session, place }: BarProps) {
  const track = useAudioQueue(playingTrackOf)
  return track !== null && <TrackBar place={place} session={session} track={track} />
}

type NowPlayingBarProps = { place: BarPlace }

/**
 * The strip under a screen while a track is queued: its cover, title and artists, play or
 * pause and next; pressed, it opens Now Playing. One sits above the tab bar and one at the foot
 * of the stack's pages, and only the one for the screen showing draws.
 */
export function NowPlayingBar({ place }: NowPlayingBarProps) {
  const session = useWren()
  const isShown = useIsBarShown(place)
  return session !== null && isShown && <Bar place={place} session={session} />
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    backgroundColor: PALETTE.raised,
    borderTopColor: PALETTE.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: SIZES.space2,
  },
  open: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: SIZES.space2,
    paddingVertical: SIZES.space1,
  },
  text: { flex: 1 },
  title: { color: PALETTE.text, fontSize: SIZES.textSm, fontWeight: 'bold' },
  line: { color: PALETTE.muted, fontSize: SIZES.textSm },
  error: { color: PALETTE.error, fontSize: SIZES.textSm },
  pressed: { opacity: OPACITIES.pressed },
})
