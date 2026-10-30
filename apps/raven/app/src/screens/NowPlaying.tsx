import { REPEAT_MODES, type RepeatMode, artistNames, formatDuration, orderedOf } from '@raven/core'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BUTTON_TONES, FormButton, ToolButton } from '@/layouts'
import { Text } from '@/layouts/Text'
import { TouchBack } from '@/layouts/TouchBack'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const COPY = {
  title: 'Now Playing',
  empty: 'Nothing is playing.',
  previous: 'Previous',
  next: 'Next',
  play: 'Play',
  pause: 'Pause',
  shuffle: 'Shuffle',
  queue: 'Up next',
  clear: 'Clear',
  remove: 'Remove',
} as const

/** What the repeat button says in each mode. */
const REPEAT_LABELS: Record<RepeatMode, string> = {
  [REPEAT_MODES.off]: 'Repeat off',
  [REPEAT_MODES.all]: 'Repeat all',
  [REPEAT_MODES.one]: 'Repeat one',
}

type NowPlayingPageProps = { session: AppQueries }

const NowPlayingPage = ({ session: { server, api } }: NowPlayingPageProps) => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  const pictures = usePictures({ server, api })
  const track = useAudioQueue(playingTrackOf)
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  const previous = useAudioQueue((store) => store.previous)
  const jump = useAudioQueue((store) => store.jump)
  const remove = useAudioQueue((store) => store.remove)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const clear = useAudioQueue((store) => store.clear)
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const cover =
    track === null || pictures === null
      ? null
      : api.albumCoverUrl({ albumId: track.albumId, coverVersion: track.album.coverVersion })
  const ordered = orderedOf(queue)

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + SIZES.space3, paddingBottom: insets.bottom + SIZES.space8 },
      ]}
      style={styles.ground}
    >
      <TouchBack onPress={() => router.back()} />
      <Text accessibilityRole="header" style={styles.title}>
        {COPY.title}
      </Text>
      {track === null && <Text style={styles.muted}>{COPY.empty}</Text>}
      {track !== null && (
        <View style={styles.stage}>
          <View style={styles.cover}>
            {cover !== null && pictures !== null && (
              <Image
                source={{ uri: cover, headers: pictures.headersFor(cover) }}
                style={styles.coverPicture}
              />
            )}
            {cover === null && <Text style={styles.initial}>{track.title.slice(0, 1)}</Text>}
          </View>
          <Text numberOfLines={2} style={styles.trackTitle}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.muted}>
            {artistNames(track)}
          </Text>
          <Text numberOfLines={1} style={styles.muted}>
            {track.album.title}
          </Text>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.time}>
            {formatDuration(position)} / {formatDuration(duration)}
          </Text>
          <View style={styles.controls}>
            <FormButton label={COPY.previous} onPress={previous} tone={BUTTON_TONES.quiet} />
            <FormButton
              label={isPlaying ? COPY.pause : COPY.play}
              onPress={toggle}
              tone={BUTTON_TONES.primary}
            />
            <FormButton label={COPY.next} onPress={next} tone={BUTTON_TONES.quiet} />
          </View>
          <View style={styles.controls}>
            <ToolButton
              accessibilityLabel={queue.isShuffled ? `${COPY.shuffle} on` : `${COPY.shuffle} off`}
              label={queue.isShuffled ? `${COPY.shuffle} on` : `${COPY.shuffle} off`}
              onPress={toggleShuffle}
            />
            <ToolButton
              accessibilityLabel={REPEAT_LABELS[queue.repeat]}
              label={REPEAT_LABELS[queue.repeat]}
              onPress={cycleRepeat}
            />
          </View>
        </View>
      )}
      {ordered.length > 0 && (
        <View style={styles.queue}>
          <View style={styles.queueHead}>
            <Text accessibilityRole="header" style={styles.heading}>
              {COPY.queue}
            </Text>
            <ToolButton accessibilityLabel={COPY.clear} label={COPY.clear} onPress={clear} />
          </View>
          {ordered.map(({ id, isCurrent }, place) => {
            const queued = tracks[id]
            if (queued === undefined) return null
            return (
              <View key={`${id}:${place}`} style={styles.row}>
                <Pressable
                  accessibilityLabel={queued.title}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrent }}
                  onPress={() => jump(place)}
                  style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                >
                  <Text numberOfLines={1} style={[styles.rowTitle, isCurrent && styles.on]}>
                    {queued.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.muted}>
                    {artistNames(queued)}
                  </Text>
                </Pressable>
                <ToolButton
                  accessibilityLabel={`${COPY.remove} ${queued.title}`}
                  label={COPY.remove}
                  onPress={() => remove(place)}
                />
              </View>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}

/** `/now-playing`: the cover large, the controls, and the queue, each track playable or removable. */
export const NowPlaying = () => {
  const session = useAppQueries()
  if (session === null) return null
  return <NowPlayingPage key={session.server.id} session={session} />
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { paddingHorizontal: SIZES.space4, gap: SIZES.space5 },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: '600' },
    stage: { alignItems: 'center', gap: SIZES.space2 },
    cover: {
      width: SIZES.cover,
      height: SIZES.cover,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    coverPicture: { width: SIZES.cover, height: SIZES.cover },
    initial: { color: colours.muted, fontSize: SIZES.controlLarge },
    trackTitle: {
      color: colours.text,
      fontSize: SIZES.textLg,
      fontWeight: '600',
      textAlign: 'center',
    },
    muted: { color: colours.muted, fontSize: SIZES.textSm },
    error: { color: colours.error, fontSize: SIZES.textSm },
    time: { color: colours.muted, fontSize: SIZES.textSm, fontVariant: ['tabular-nums'] },
    controls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SIZES.space2,
      justifyContent: 'center',
    },
    on: { color: colours.accent },
    queue: { gap: SIZES.space2 },
    queueHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
    rowMain: { flex: 1, paddingVertical: SIZES.space2 },
    rowTitle: { color: colours.text, fontSize: SIZES.text },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
