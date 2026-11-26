import { formatDuration, remainingTimeOf } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, progressOf, scrubTextOf } from '@raven/wren'
import { useState } from 'react'
import { Text, TVFocusGuideView, View, useTVEventHandler } from 'react-native'

import { scrubStepOf } from '@/player/scrubStep'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { Focusable } from '@/ui/Focusable'

const useStyles = themedStyles(({ colors }) => ({
  scrubber: { gap: SPACE.s1 },
  line: {
    backgroundColor: colors.line2,
    borderRadius: RADIUS.pill,
    height: SIZE.scrubber,
    justifyContent: 'center',
  },
  played: {
    backgroundColor: colors.text2,
    borderRadius: RADIUS.pill,
    height: SIZE.scrubber,
  },
  playedLit: { backgroundColor: colors.accentText },
  thumb: {
    backgroundColor: colors.text,
    borderRadius: RADIUS.pill,
    height: SIZE.scrubberThumb,
    position: 'absolute',
    // Centred on the playhead, which `left` places.
    transform: [{ translateX: -SIZE.scrubberThumb / 2 }],
    width: SIZE.scrubberThumb,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { ...TYPE.time, color: colors.text3 },
}))

type ScrubberProps = {
  /** The track's length, in seconds. */
  length: number
}

/**
 * The scrubber: the line the remote's left and right step through the track while it holds the
 * focus, read out as "1:02 of 4:44", over how far in it is and how long is left, "-3:42". It
 * keeps left and right for itself, so they seek rather than move the focus off it.
 */
export function Scrubber({ length }: ScrubberProps) {
  const styles = useStyles()
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const [isFocused, setIsFocused] = useState(false)
  useTVEventHandler((event) => {
    if (!isFocused) return
    const to = scrubStepOf({ event, position, length })
    if (to !== null) seekTo(to)
  })
  const share = `${progressOf({ position, length }) * 100}%` as const
  return (
    <TVFocusGuideView style={styles.scrubber} trapFocusLeft trapFocusRight>
      <Focusable
        hasRing={false}
        hint={scrubTextOf({ position, length })}
        label={PLAYER_COPY.position}
        onBlur={() => setIsFocused(false)}
        onFocus={() => setIsFocused(true)}
        onPress={() => undefined}
        style={styles.line}
      >
        <View style={[styles.played, isFocused && styles.playedLit, { width: share }]} />
        {isFocused && <View style={[styles.thumb, { left: share }]} />}
      </Focusable>
      <View style={styles.times}>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.time}>
          {formatDuration(position)}
        </Text>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.time}>
          {remainingTimeOf({ position, length })}
        </Text>
      </View>
    </TVFocusGuideView>
  )
}
