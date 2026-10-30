import { artistNames } from '@raven/core'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter, useSegments } from 'expo-router'
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/layouts/Text'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const COPY = { play: 'Play', pause: 'Pause', next: 'Next', open: 'Open Now Playing' } as const

/** The screens the bar stays off: the film player, and Now Playing, which is the bar opened up. */
const BARLESS_SCREENS: ReadonlySet<string> = new Set([APP_SCREENS.play, APP_SCREENS.nowPlaying])

/**
 * Whether the bar shows: while a track is queued, on an iPhone or iPad, off the screens above.
 * The TVs have no bar until their music screens take focus layouts.
 */
export const useIsBarShown = (): boolean => {
  const screen = useSegments().join('/')
  const hasTrack = useAudioQueue((store) => playingTrackOf(store) !== null)
  return !Platform.isTV && hasTrack && !BARLESS_SCREENS.has(screen)
}

type NowPlayingBarProps = { session: Pick<AppQueries, 'server' | 'api'> }

/**
 * The strip under the screens while a track plays: its cover, title and artists, play or pause
 * and next; pressed, it opens Now Playing.
 */
export const NowPlayingBar = ({ session: { server, api } }: NowPlayingBarProps) => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  const pictures = usePictures({ server, api })
  const track = useAudioQueue(playingTrackOf)
  const state = useAudioQueue((store) => store.state)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  const isShown = useIsBarShown()
  if (track === null || !isShown) return null
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const cover = api.albumCoverUrl({
    albumId: track.albumId,
    coverVersion: track.album.coverVersion,
  })
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, SIZES.space2) }]}>
      <Pressable
        accessibilityLabel={COPY.open}
        accessibilityRole="button"
        onPress={() => router.push(APP_ROUTES.nowPlaying)}
        style={({ pressed }) => [styles.words, pressed && styles.pressed]}
      >
        <View style={styles.thumb}>
          {cover !== null && pictures !== null && (
            <Image
              source={{ uri: cover, headers: pictures.headersFor(cover) }}
              style={styles.thumbPicture}
            />
          )}
        </View>
        <View style={styles.lines}>
          <Text numberOfLines={1} style={styles.title}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.line}>
            {artistNames(track)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={isPlaying ? COPY.pause : COPY.play}
        accessibilityRole="button"
        hitSlop={SIZES.space2}
        onPress={toggle}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonLabel}>{isPlaying ? COPY.pause : COPY.play}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={COPY.next}
        accessibilityRole="button"
        hitSlop={SIZES.space2}
        onPress={next}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonLabel}>{COPY.next}</Text>
      </Pressable>
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space3,
      paddingHorizontal: SIZES.space3,
      paddingTop: SIZES.space2,
      backgroundColor: colours.raised,
    },
    words: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    thumb: {
      width: SIZES.fieldHeight,
      height: SIZES.fieldHeight,
      borderRadius: SIZES.radius,
      backgroundColor: colours.ground,
      overflow: 'hidden',
    },
    thumbPicture: { width: SIZES.fieldHeight, height: SIZES.fieldHeight },
    lines: { flex: 1 },
    title: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
    line: { color: colours.muted, fontSize: SIZES.textXs },
    button: {
      paddingHorizontal: SIZES.space2,
      paddingVertical: SIZES.space1,
      borderRadius: SIZES.radius,
      backgroundColor: colours.ground,
    },
    buttonLabel: { color: colours.text, fontSize: SIZES.textSm },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
