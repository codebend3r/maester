import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Video, { type VideoMetadata } from 'react-native-video'

import { type PlayerChromeKit, type PlayerChromeProps } from '@/layouts/playerKit'
import { plateStyles } from '@/layouts/tvControls'
import { COLOURS, SIZES } from '@/theme/appTheme'

const GUTTER = SIZES.space8

const BACK = 'Back'

/** What the system's info panel shows: the title, the synopsis and the poster, where known. */
const infoOf = ({
  title,
  summary,
  artwork,
}: Pick<PlayerChromeProps, 'title' | 'summary' | 'artwork'>): VideoMetadata => ({
  title,
  ...(summary === null ? {} : { description: summary }),
  ...(artwork === null ? {} : { imageUri: artwork }),
})

/**
 * The video under the system's own transport on a TV (AVPlayerViewController on Apple TV): the
 * remote's swipe scrubs, a press plays and pauses, the info panel shows the title, synopsis and
 * poster, and the audio and subtitle panel lists the stream's renditions. raven draws nothing
 * over it, so the transport owns the remote's focus, and Menu leaves the player. While there is
 * nothing to play (opening, refused, or no way left), the title and the line stand alone with
 * Back, which takes the remote's focus as it appears and lets go once it has had it.
 */
const PlayerChrome = ({ title, summary, artwork, surface, notice, onBack }: PlayerChromeProps) => {
  const [isOpening, setOpening] = useState(true)
  const source = surface?.source ?? null
  // The source is the video: a new object of the same values must not reload it.
  const withInfo = useMemo(
    () =>
      source === null ? undefined : { ...source, metadata: infoOf({ title, summary, artwork }) },
    [source, title, summary, artwork],
  )
  if (surface !== null) {
    return (
      <View style={styles.ground}>
        <Video
          {...surface}
          controls
          resizeMode="contain"
          source={withInfo}
          style={StyleSheet.absoluteFill}
        />
      </View>
    )
  }
  return (
    <View style={[styles.ground, styles.page]}>
      {title !== '' && (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      )}
      {notice !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={BACK}
          accessibilityRole="button"
          hasTVPreferredFocus={isOpening}
          onFocus={() => setOpening(false)}
          onPress={onBack}
          style={({ focused }) => [plateStyles.plate, focused && plateStyles.focused]}
        >
          <Text style={plateStyles.label}>{BACK}</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** The player on a TV: the system's transport, which the remote drives. */
export const focusPlayerChrome: PlayerChromeKit = { PlayerChrome, shouldDrawCaptions: false }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  page: { justifyContent: 'center', gap: SIZES.space4, paddingHorizontal: GUTTER },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  notice: {
    maxWidth: SIZES.measure,
    color: COLOURS.text,
    fontSize: SIZES.textLg,
  },
  actions: { flexDirection: 'row' },
})
