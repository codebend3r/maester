import { Pressable, Text, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'

import type { Cover } from '@/music/useCovers'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { PLAYER_COPY } from '@/ui/copy'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: {
    backgroundColor: colors.raised,
    borderColor: colors.line,
    borderRadius: RADIUS.lg,
    borderWidth: SIZE.hairline,
    height: SIZE.miniPlayer,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: SPACE.s2 },
    shadowOpacity: 1,
    shadowRadius: SPACE.s5,
    elevation: SPACE.s2,
  },
  row: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    paddingLeft: SIZE.floatInset,
    paddingRight: SPACE.s1,
  },
  open: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SPACE.s3, height: '100%' },
  text: { flex: 1 },
  title: { ...TYPE.rowStrong, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
  error: { ...TYPE.meta, color: colors.accentText },
  track: { bottom: 0, height: SIZE.progressLine, left: 0, position: 'absolute', right: 0 },
  progress: { backgroundColor: colors.accentText, height: '100%' },
}))

// How far up a finger moves the card before letting go opens Now Playing.
const SWIPE_UP = -SIZE.miniPlayer / 2

type MiniPlayerProps = {
  title: string
  artists: string
  cover: Cover | null
  /** What went wrong playing, said in the artists' place. */
  error: string | null
  isPlaying: boolean
  /** How far through the track it is, from 0 to 1. */
  progress: number
  onOpen: () => void
  onToggle: () => void
  onNext: () => void
}

/**
 * The phone's floating card while a track is queued: its cover, title and artists, pause or
 * play and next, and a thin red line for how far it has played. A tap or a swipe up opens Now
 * Playing.
 */
export function MiniPlayer({
  title,
  artists,
  cover,
  error,
  isPlaying,
  progress,
  onOpen,
  onToggle,
  onNext,
}: MiniPlayerProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const swipe = usePanGesture({
    activeOffsetY: [-SPACE.s2, SPACE.s2],
    runOnJS: true,
    onDeactivate: ({ translationY }) => {
      if (translationY < SWIPE_UP) onOpen()
    },
  })
  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Pressable
            accessibilityLabel={PLAYER_COPY.open({ title, artists })}
            accessibilityRole="button"
            onPress={onOpen}
            style={pressedStyleOf({ style: styles.open })}
          >
            <AlbumArt cover={cover} radius={RADIUS.thumb} size={SIZE.miniArt} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
              <Text numberOfLines={1} style={error === null ? styles.line : styles.error}>
                {error ?? artists}
              </Text>
            </View>
          </Pressable>
          <IconButton
            color={colors.text}
            icon={isPlaying ? ICONS.pause : ICONS.play}
            label={isPlaying ? PLAYER_COPY.pause : PLAYER_COPY.play}
            onPress={onToggle}
          />
          <IconButton
            color={colors.text}
            icon={ICONS.next}
            label={PLAYER_COPY.next}
            onPress={onNext}
          />
        </View>
        <View style={styles.track}>
          <View style={[styles.progress, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>
    </GestureDetector>
  )
}
