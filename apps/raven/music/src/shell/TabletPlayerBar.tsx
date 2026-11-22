import type { Track } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { factsLineOf, PLAYER_COPY, TRANSPORTS } from '@raven/wren'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber'
import { Transport } from '@/player/Transport'
import { useNowPlaying } from '@/player/useNowPlaying'
import { useQuality } from '@/player/useQuality'
import { WREN_ROUTES } from '@/routes'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SHELL_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { ICONS } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  bar: {
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderTopColor: colors.line,
    borderTopWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SPACE.s5,
    minHeight: SHELL_SIZES.tabletPlayerBar,
    paddingHorizontal: SPACE.s6,
  },
  side: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SPACE.s3 },
  end: { justifyContent: 'flex-end' },
  nowPlaying: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SPACE.s4 },
  text: { flex: 1 },
  title: { ...TYPE.rowStrong, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
  quality: { ...TYPE.meta, color: colors.text3 },
  error: { ...TYPE.meta, color: colors.accentText },
  centre: { alignItems: 'center', width: SHELL_SIZES.scrubber },
}))

type PlayingBarProps = { session: WrenSession; track: Track }

function PlayingBar({ session, track }: PlayingBarProps) {
  const styles = useStyles()
  const router = useRouter()
  const { bottom } = useSafeAreaInsets()
  const { cover, artists, length, error } = useNowPlaying({ session, track })
  const quality = useQuality({ track })
  const openNowPlaying = () => router.push(WREN_ROUTES.nowPlaying)
  return (
    <View style={[styles.bar, { paddingBottom: bottom }]}>
      <View style={styles.side}>
        <Pressable
          accessibilityLabel={PLAYER_COPY.open({ title: track.title, artists })}
          accessibilityRole="button"
          onPress={openNowPlaying}
          style={pressedStyleOf({ style: styles.nowPlaying })}
        >
          <AlbumArt cover={cover} radius={RADIUS.thumb} size={SHELL_SIZES.barArt} />
          <View style={styles.text}>
            <Text numberOfLines={1} style={styles.title}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={error === null ? styles.line : styles.error}>
              {error ?? factsLineOf([artists, track.album.title])}
            </Text>
            {quality !== null && error === null && (
              <Text numberOfLines={1} style={styles.quality}>
                {quality}
              </Text>
            )}
          </View>
        </Pressable>
      </View>
      <View style={styles.centre}>
        <Transport kind={TRANSPORTS.bar} />
        <Scrubber kind={SCRUBBERS.bar} length={length} />
      </View>
      <View style={[styles.side, styles.end]}>
        <IconButton icon={ICONS.lyrics} label={PLAYER_COPY.lyrics} onPress={openNowPlaying} />
        <IconButton icon={ICONS.upNext} label={PLAYER_COPY.upNext} onPress={openNowPlaying} />
        <IconButton icon={ICONS.output} label={PLAYER_COPY.output} onPress={openNowPlaying} />
      </View>
    </View>
  )
}

/**
 * The tablet's player bar along the foot of every page while a track is queued: what plays,
 * the transport and the scrubber in the middle, and Lyrics, Up next and Output, which open Now
 * Playing.
 */
export function TabletPlayerBar() {
  const session = useWren()
  const track = useAudioQueue(playingTrackOf)
  return session !== null && track !== null && <PlayingBar session={session} track={track} />
}
