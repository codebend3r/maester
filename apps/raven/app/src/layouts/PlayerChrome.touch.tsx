import { formatDuration } from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { useEffect, useState } from 'react'
import {
  Animated,
  type GestureResponderEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Video from 'react-native-video'

import { touchPicker } from '@/layouts/Picker.touch'
import { CaptionText } from '@/layouts/PlayerCaption'
import {
  PLAYER_COPY,
  type PlayerChromeKit,
  type PlayerChromeProps,
  SKIP_SECONDS,
  type Transport,
  playedShareOf,
  scrubberAccessibilityOf,
  within,
} from '@/layouts/playerKit'
import { TouchBack } from '@/layouts/TouchBack'
import { useReduceMotion } from '@/stores/reduceMotion'
import { COLOURS, SIZES } from '@/theme/appTheme'

const { Picker, ToolButton } = touchPicker

/** How long the controls take to fade, where motion is allowed. */
const FADE_MS = 200

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** The scrubber's height: a finger's, though the line it draws is thin. */
const SCRUBBER_HEIGHT = 44

// The variation selector keeps the play triangle a glyph of the font rather than an emoji.
const GLYPHS = {
  play: '\u25B6\uFE0E',
  pause: '\u275A\u275A',
  back: `\u21BA ${SKIP_SECONDS}`,
  forward: `${SKIP_SECONDS} \u21BB`,
} as const

/**
 * Where the video is, as a line to drag along: the finger's spot shows as it moves and is sought
 * on letting go. VoiceOver reads it as the time of the length, and skips by a swipe.
 */
const Scrubber = ({
  position,
  duration,
  onSeek,
}: Pick<Transport, 'position' | 'onSeek'> & { duration: number }) => {
  const [width, setWidth] = useState(0)
  const [dragged, setDragged] = useState<number | null>(null)
  const timeAt = (event: GestureResponderEvent): number =>
    width <= 0
      ? position
      : within({ value: (event.nativeEvent.locationX / width) * duration, length: duration })
  const shown = dragged ?? position
  const share = playedShareOf({ at: shown, duration })
  return (
    <View
      {...scrubberAccessibilityOf({ position, shown, duration, onSeek })}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => setDragged(timeAt(event))}
      onResponderMove={(event) => setDragged(timeAt(event))}
      onResponderRelease={(event) => {
        onSeek(timeAt(event))
        setDragged(null)
      }}
      onResponderTerminate={() => setDragged(null)}
      onStartShouldSetResponder={() => true}
      style={styles.scrubber}
    >
      <View pointerEvents="none" style={styles.line}>
        <View style={[styles.played, { width: share }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: share }]} />
    </View>
  )
}

const RoundButton = ({
  glyph,
  label,
  isLarge = false,
  onPress,
}: {
  glyph: string
  label: string
  isLarge?: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    hitSlop={SIZES.space2}
    onPress={onPress}
    style={({ pressed }) => [styles.round, isLarge && styles.roundLarge, pressed && styles.pressed]}
  >
    <Text style={[styles.glyph, isLarge && styles.glyphLarge]}>{glyph}</Text>
  </Pressable>
)

/** Play and pause between the skips, then the time over the line to drag along. */
const TransportControls = ({ transport }: { transport: Transport }) => {
  const { isPaused, position, duration, onTogglePlay, onSeek } = transport
  const length = duration ?? 0
  return (
    <>
      <View pointerEvents="box-none" style={styles.middle}>
        <RoundButton
          glyph={GLYPHS.back}
          label={PLAYER_COPY.back(SKIP_SECONDS)}
          onPress={() => onSeek(position - SKIP_SECONDS)}
        />
        <RoundButton
          glyph={isPaused ? GLYPHS.play : GLYPHS.pause}
          isLarge
          label={isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
          onPress={onTogglePlay}
        />
        <RoundButton
          glyph={GLYPHS.forward}
          label={PLAYER_COPY.forward(SKIP_SECONDS)}
          onPress={() => onSeek(position + SKIP_SECONDS)}
        />
      </View>
      <View style={styles.bottom}>
        <Text style={styles.time}>{formatDuration(position)}</Text>
        <View style={styles.scrubberSlot}>
          <Scrubber duration={length} onSeek={onSeek} position={position} />
        </View>
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </View>
    </>
  )
}

/**
 * Raven's controls over the video under the thumb: Back, the title and the track pickers along
 * the top, play and pause between the ten-second skips in the middle, the time and the line to
 * drag along the bottom, all inside the safe area while the video fills the screen. They fade
 * once the video has played untouched for the viewer's linger, and a tap brings them back. The
 * video plays in Picture in Picture when the app is left, and on AirPlay; the silent switch never
 * mutes it, and leaving the app without Picture in Picture pauses it.
 */
const PlayerChrome = ({
  title,
  surface,
  notice,
  caption,
  transport,
  audio,
  subtitles,
  onPictureInPicture,
  onBack,
}: PlayerChromeProps) => {
  const insets = useSafeAreaInsets()
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [isShown, setShown] = useState(true)
  const [stirredAt, setStirredAt] = useState(() => Date.now())
  const [opacity] = useState(() => new Animated.Value(1))
  const isPlaying = transport !== null && !transport.isPaused
  // Only a video that plays hides its controls: paused, opening or ended, they stay up.
  const isVisible = isShown || !isPlaying

  useEffect(() => {
    if (!isShown || !isPlaying) return undefined
    const left = Math.max(0, stirredAt + lingerSeconds * 1000 - Date.now())
    const timer = setTimeout(() => setShown(false), left)
    return () => clearTimeout(timer)
  }, [isShown, isPlaying, lingerSeconds, stirredAt])

  useEffect(() => {
    const toValue = isVisible ? 1 : 0
    if (isReduced) {
      opacity.setValue(toValue)
      return undefined
    }
    const fade = Animated.timing(opacity, { toValue, duration: FADE_MS, useNativeDriver: true })
    fade.start()
    return () => fade.stop()
  }, [isVisible, isReduced, opacity])

  const stir = () => setStirredAt(Date.now())
  const sides = {
    paddingTop: insets.top + SIZES.space2,
    paddingBottom: insets.bottom + SIZES.space2,
    paddingLeft: Math.max(insets.left, SIZES.space4),
    paddingRight: Math.max(insets.right, SIZES.space4),
  }
  return (
    <View style={styles.root}>
      <StatusBar hidden={!isVisible} />
      {surface !== null && (
        <Video
          {...surface}
          allowsExternalPlayback
          controls={false}
          enterPictureInPictureOnLeave
          ignoreSilentSwitch="ignore"
          playInBackground={false}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
        />
      )}
      <Pressable
        accessibilityLabel={isVisible ? PLAYER_COPY.hideControls : PLAYER_COPY.showControls}
        accessibilityRole="button"
        disabled={!isPlaying}
        onPress={() => {
          stir()
          setShown(!isVisible)
        }}
        style={StyleSheet.absoluteFill}
      />
      {notice !== null && (
        <View pointerEvents="none" style={[styles.noticeSlot, sides]}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        </View>
      )}
      <Animated.View
        accessibilityElementsHidden={!isVisible}
        importantForAccessibility={isVisible ? 'auto' : 'no-hide-descendants'}
        onTouchStart={stir}
        pointerEvents={isVisible ? 'box-none' : 'none'}
        style={[StyleSheet.absoluteFill, { opacity }]}
      >
        <View pointerEvents="none" style={styles.scrim} />
        <View pointerEvents="box-none" style={[styles.frame, sides]}>
          <View style={styles.top}>
            <View style={styles.heading}>
              <TouchBack isRaised onPress={onBack} />
              <Text numberOfLines={2} style={styles.title}>
                {title}
              </Text>
            </View>
            <View style={styles.tools}>
              {audio !== null && <Picker label={PLAYER_COPY.audio} {...audio} />}
              {subtitles !== null && <Picker label={PLAYER_COPY.subtitles} {...subtitles} />}
              {onPictureInPicture !== null && (
                <ToolButton
                  accessibilityLabel={PLAYER_COPY.pictureInPicture}
                  label={PLAYER_COPY.pictureInPicture}
                  onPress={onPictureInPicture}
                />
              )}
            </View>
          </View>
          {transport !== null && <TransportControls transport={transport} />}
        </View>
      </Animated.View>
      {caption !== null && (
        <View pointerEvents="none" style={[styles.captionSlot, sides]}>
          <CaptionText caption={caption} />
        </View>
      )}
    </View>
  )
}

/** The player under the thumb, on iPhones and iPads. */
export const touchPlayerChrome: PlayerChromeKit = { PlayerChrome, shouldDrawCaptions: true }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOURS.ground },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: COLOURS.ground,
    opacity: SCRIM_OPACITY,
  },
  frame: { flex: 1, justifyContent: 'space-between' },
  top: { gap: SIZES.space2 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
  tools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: SIZES.space2,
  },
  title: { flex: 1, color: COLOURS.onPicture, fontSize: SIZES.text, fontWeight: '600' },
  middle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SIZES.space6,
  },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
  time: { color: COLOURS.onPicture, fontSize: SIZES.textSm, fontVariant: ['tabular-nums'] },
  scrubberSlot: { flex: 1 },
  scrubber: { height: SCRUBBER_HEIGHT, justifyContent: 'center' },
  line: {
    height: SIZES.space1,
    borderRadius: SIZES.space1,
    backgroundColor: COLOURS.track,
    overflow: 'hidden',
  },
  played: { height: '100%', backgroundColor: COLOURS.accent },
  thumb: {
    position: 'absolute',
    width: SIZES.space4,
    height: SIZES.space4,
    marginLeft: -SIZES.space4 / 2,
    borderRadius: SIZES.space4,
    backgroundColor: COLOURS.onPicture,
  },
  round: {
    minWidth: SIZES.controlLarge,
    minHeight: SIZES.controlLarge,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SIZES.controlLarge,
    paddingHorizontal: SIZES.space2,
    backgroundColor: COLOURS.deep,
  },
  roundLarge: {
    minWidth: SIZES.controlLarge * 1.5,
    minHeight: SIZES.controlLarge * 1.5,
    backgroundColor: COLOURS.accent,
  },
  pressed: { opacity: 0.6 },
  glyph: { color: COLOURS.onPicture, fontSize: SIZES.text, fontWeight: '600' },
  glyphLarge: { color: COLOURS.onAccent, fontSize: SIZES.textXl },
  captionSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-end',
    // Clear of the time and the scrubber along the bottom.
    marginBottom: SIZES.controlLarge + SIZES.space4,
  },
  noticeSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  notice: {
    maxWidth: SIZES.measure,
    color: COLOURS.onPicture,
    fontSize: SIZES.text,
    textAlign: 'center',
  },
})
