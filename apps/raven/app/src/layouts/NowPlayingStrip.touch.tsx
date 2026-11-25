import { Icon } from '@raven/native'
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MUSIC_COPY } from '@/layouts/copy'
import { type NowPlayingStripProps, toggleLabelOf } from '@/layouts/musicKit'
import { useMusicStyles } from '@/layouts/MusicParts.touch'
import { TouchQualityLine } from '@/layouts/QualityLine'
import { isTablet } from '@/layouts/screenSizes'
import { Text } from '@/layouts/Text'
import { SIZES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { themedStyles, useTheme } from '@/theme/useTheme'

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
    barWords: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    thumb: {
      width: SIZES.fieldHeight,
      height: SIZES.fieldHeight,
      borderRadius: SIZES.radius,
      backgroundColor: colours.ground,
      overflow: 'hidden',
    },
    thumbPicture: { width: SIZES.fieldHeight, height: SIZES.fieldHeight },
    lines: { flex: 1 },
    barTitle: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
    barLine: { color: colours.muted, fontSize: SIZES.textXs },
    barButton: {
      paddingHorizontal: SIZES.space2,
      paddingVertical: SIZES.space1,
      borderRadius: SIZES.radius,
      backgroundColor: colours.ground,
    },
    barButtonLabel: { color: colours.text, fontSize: SIZES.textSm },
    close: {
      minWidth: SIZES.fieldHeight,
      minHeight: SIZES.fieldHeight,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
)

type BarButtonProps = { label: string; onPress: () => void }

/** Play or Pause, or Next, beside the strip's words: its word, with room round it for a thumb. */
const BarButton = ({ label, onPress }: BarButtonProps) => {
  const music = useMusicStyles()
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space2}
      onPress={onPress}
      style={({ pressed }) => [styles.barButton, pressed && music.pressed]}
    >
      <Text style={styles.barButtonLabel}>{label}</Text>
    </Pressable>
  )
}

/**
 * The strip under the screens while a track plays: its cover, title and artists, play or pause,
 * next, and an X at the right that stops the music and closes it; pressed, it opens Now Playing.
 * A tablet's strip has room for the format and quality beside the words; a phone's has none.
 */
export const NowPlayingStrip = ({
  title,
  artists,
  cover,
  quality,
  isPlaying,
  onOpen,
  onToggle,
  onNext,
  onClose,
}: NowPlayingStripProps) => {
  const insets = useSafeAreaInsets()
  const hasRoom = isTablet(useWindowDimensions())
  const muted = useTheme((theme) => theme.palette.muted)
  const music = useMusicStyles()
  const styles = useStyles()
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, SIZES.space2) }]}>
      <Pressable
        accessibilityLabel={MUSIC_COPY.openNowPlaying}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.barWords, pressed && music.pressed]}
      >
        <View style={styles.thumb}>
          {cover !== null && <Image source={cover} style={styles.thumbPicture} />}
        </View>
        <View style={styles.lines}>
          <Text numberOfLines={1} style={styles.barTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.barLine}>
            {artists}
          </Text>
        </View>
        {hasRoom && quality !== null && <TouchQualityLine quality={quality} />}
      </Pressable>
      <BarButton label={toggleLabelOf(isPlaying)} onPress={onToggle} />
      <BarButton label={MUSIC_COPY.next} onPress={onNext} />
      <Pressable
        accessibilityLabel={MUSIC_COPY.closePlayer}
        accessibilityRole="button"
        hitSlop={SIZES.space1}
        onPress={onClose}
        style={({ pressed }) => [styles.close, pressed && music.pressed]}
      >
        <Icon colour={muted} name={APP_ICONS.close} size={SIZES.textLg} />
      </Pressable>
    </View>
  )
}
