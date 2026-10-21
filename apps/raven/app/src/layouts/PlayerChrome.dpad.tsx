import { formatDuration } from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentRef, type RefObject, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  StyleSheet,
  type TVRemoteEvent,
  Text,
  View,
  useTVEventHandler,
} from 'react-native'
import Video from 'react-native-video'

import { FocusBand } from '@/layouts/FocusBand'
import { focusPicker } from '@/layouts/Picker.focus'
import { CaptionText } from '@/layouts/PlayerCaption'
import { PlayerNotice } from '@/layouts/PlayerNotice.focus'
import {
  PLAYER_COPY,
  type PlayerChromeKit,
  type PlayerChromeProps,
  type Transport,
  type VideoSurface,
  playedShareOf,
  scrubberAccessibilityOf,
} from '@/layouts/playerKit'
import { pressedKeyOf, remoteAnswerOf } from '@/layouts/remoteKeys'
import { PlateButton } from '@/layouts/tvControls'
import { requestTVFocus } from '@/layouts/tvFocus'
import { useReduceMotion } from '@/stores/reduceMotion'
import { COLOURS } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'

const { Picker } = focusPicker

const GUTTER = TV_SIZES.space8

const BACK = 'Back'

/** How long the controls take to fade, where motion is allowed. */
const FADE_MS = 200

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** The thumb on the line, and how much it grows while the remote is on it. */
const THUMB = TV_SIZES.space4
const THUMB_FOCUSED = TV_SIZES.space6

type Focusable = RefObject<ComponentRef<typeof Pressable> | null>

/** Asks the remote's focus for the view once, as it is drawn: each time the controls appear. */
const useFocusOnMount = (view: Focusable) => {
  useEffect(() => {
    requestTVFocus(view.current)
  }, [view])
}

/**
 * Hears the remote through the fork's `useTVEventHandler`, which subscribes again whenever its
 * listener changes; one listener for the chrome's life reads the latest answer instead.
 */
const useRemote = (respond: (event: TVRemoteEvent) => void) => {
  const latest = useRef(respond)
  useEffect(() => {
    latest.current = respond
  })
  const [listener] = useState(() => (event: TVRemoteEvent) => latest.current(event))
  useTVEventHandler(listener)
}

/**
 * The controls' opacity, and whether they are drawn: they fade in as they appear and are drawn
 * until they have faded out, or appear and go at once when the system asks for less motion.
 */
const useFade = ({ isVisible, isReduced }: { isVisible: boolean; isReduced: boolean }) => {
  const [opacity] = useState(() => new Animated.Value(isVisible ? 1 : 0))
  // Where the last fade came to rest: the controls stay drawn while one runs out from it.
  const [hasRestedVisible, setRestedVisible] = useState(isVisible)
  useEffect(() => {
    const toValue = isVisible ? 1 : 0
    if (isReduced) {
      opacity.setValue(toValue)
      return undefined
    }
    const fade = Animated.timing(opacity, { toValue, duration: FADE_MS, useNativeDriver: true })
    fade.start(({ finished }) => {
      if (finished) setRestedVisible(isVisible)
    })
    return () => fade.stop()
  }, [isVisible, isReduced, opacity])
  return { opacity, isDrawn: isVisible || (!isReduced && hasRestedVisible) }
}

/**
 * Where the video is, as a line the remote stands on: while it has the focus, left and right
 * skip ten seconds (the chrome hears them) and a press plays or pauses. It asks for the focus as
 * it appears and lets go once it has had it; on the player's first appearance the screen is
 * still sliding in, when only the preferred focus, set with the view, takes. TalkBack reads it as
 * the time of the length and skips by its own gesture.
 */
const Scrubber = ({
  view,
  transport,
  onScrubbing,
}: {
  view: Focusable
  transport: Transport
  onScrubbing: (isScrubbing: boolean) => void
}) => {
  const [isOpening, setOpening] = useState(true)
  const { position, onSeek, onTogglePlay } = transport
  const duration = transport.duration ?? 0
  const share = playedShareOf({ at: position, duration })
  return (
    <Pressable
      ref={view}
      {...scrubberAccessibilityOf({ position, shown: position, duration, onSeek })}
      hasTVPreferredFocus={isOpening}
      onBlur={() => onScrubbing(false)}
      onFocus={() => {
        setOpening(false)
        onScrubbing(true)
      }}
      onPress={onTogglePlay}
      style={styles.scrubber}
    >
      {({ focused }) => (
        <>
          <View style={[styles.line, focused && styles.lineFocused]}>
            <View style={[styles.played, { width: share }]} />
          </View>
          <View
            style={[
              styles.thumb,
              focused && styles.thumbFocused,
              { left: share, marginLeft: -(focused ? THUMB_FOCUSED : THUMB) / 2 },
            ]}
          />
        </>
      )}
    </Pressable>
  )
}

/**
 * The controls over the video: the title along the top; the time and the line along the
 * bottom, over play and pause, the track pickers and Back. The line takes the remote's focus
 * as they appear, so a press of left or right goes on skipping; the buttons are a band, so Down
 * from the line lands on the first of them rather than on the one under the thumb.
 */
const Controls = ({
  title,
  transport,
  audio,
  subtitles,
  onBack,
  onScrubbing,
  onPicking,
  onBottomHeight,
  isVisible,
}: Pick<PlayerChromeProps, 'title' | 'transport' | 'audio' | 'subtitles' | 'onBack'> & {
  /** Whether the controls are showing, not fading out: each time they come back the line asks for the focus. */
  isVisible: boolean
  onScrubbing: (isScrubbing: boolean) => void
  onPicking: (isPicking: boolean) => void
  onBottomHeight: (height: number) => void
}) => {
  const scrubber: Focusable = useRef(null)
  // Brought back while they fade out, the controls are still drawn, and the hidden state's
  // catcher, which had the focus, goes: the line asks again.
  useEffect(() => {
    if (isVisible) requestTVFocus(scrubber.current)
  }, [isVisible])
  return (
    <View style={styles.frame}>
      <Text numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      <View
        onLayout={({ nativeEvent }) => onBottomHeight(nativeEvent.layout.height)}
        style={styles.bottom}
      >
        {transport !== null && (
          <View style={styles.timeline}>
            <Text style={styles.time}>{formatDuration(transport.position)}</Text>
            <View style={styles.scrubberSlot}>
              <Scrubber onScrubbing={onScrubbing} transport={transport} view={scrubber} />
            </View>
            <Text style={styles.time}>{formatDuration(transport.duration)}</Text>
          </View>
        )}
        <FocusBand>
          <View style={styles.buttons}>
            {transport !== null && (
              <PlateButton
                accessibilityRole="button"
                label={transport.isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
                onPress={transport.onTogglePlay}
                text={transport.isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
              />
            )}
            {audio !== null && (
              <Picker label={PLAYER_COPY.audio} onOpenChange={onPicking} {...audio} />
            )}
            {subtitles !== null && (
              <Picker label={PLAYER_COPY.subtitles} onOpenChange={onPicking} {...subtitles} />
            )}
            <PlateButton accessibilityRole="button" label={BACK} onPress={onBack} text={BACK} />
          </View>
        </FocusBand>
      </View>
    </View>
  )
}

/** While the controls are hidden, the one thing on screen to hold the remote's focus. */
const ControlsCatcher = ({ onPress }: { onPress: () => void }) => {
  const catcher: Focusable = useRef(null)
  useFocusOnMount(catcher)
  return (
    <Pressable
      ref={catcher}
      accessibilityLabel={PLAYER_COPY.showControls}
      accessibilityRole="button"
      onPress={onPress}
      style={StyleSheet.absoluteFill}
    />
  )
}

/**
 * raven's own controls over ExoPlayer, driven by the d-pad. They fade once the video has played
 * untouched for the viewer's linger, and any key brings them back; they stay up while it is
 * paused, opening or ended, and while a picker's list is open. Hidden, left and right still skip
 * ten seconds, and the remote's play, rewind and fast forward keys work wherever the focus is.
 * The subtitle cues are raven's, over the video whether or not the controls are.
 */
const DpadPlayer = ({
  title,
  surface,
  notice,
  caption,
  transport,
  audio,
  subtitles,
  onBack,
}: PlayerChromeProps & { surface: VideoSurface }) => {
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [isShown, setShown] = useState(true)
  const [stirredAt, setStirredAt] = useState(() => Date.now())
  const [isScrubbing, setScrubbing] = useState(false)
  const [isPicking, setPicking] = useState(false)
  const [bottomHeight, setBottomHeight] = useState(0)
  const isPlaying = transport !== null && !transport.isPaused
  // Only a video that plays hides its controls: paused, opening or ended, they stay up.
  const isVisible = isShown || !isPlaying
  const { opacity, isDrawn } = useFade({ isVisible, isReduced })

  useEffect(() => {
    if (!isShown || !isPlaying || isPicking) return undefined
    const left = Math.max(0, stirredAt + lingerSeconds * 1000 - Date.now())
    const timer = setTimeout(() => {
      setShown(false)
      setScrubbing(false)
    }, left)
    return () => clearTimeout(timer)
  }, [isShown, isPlaying, isPicking, lingerSeconds, stirredAt])

  const show = () => {
    setStirredAt(Date.now())
    setShown(true)
  }

  useRemote((event) => {
    const key = pressedKeyOf(event)
    if (key === null) return
    show()
    if (transport === null) return
    const { seekBy, shouldTogglePlay } = remoteAnswerOf({
      key,
      isShown: isVisible,
      isScrubbing,
      isPaused: transport.isPaused,
    })
    if (seekBy !== 0) transport.onSeek(transport.position + seekBy)
    if (shouldTogglePlay) transport.onTogglePlay()
  })

  return (
    <View style={styles.root}>
      <Video {...surface} controls={false} resizeMode="contain" style={StyleSheet.absoluteFill} />
      {!isVisible && <ControlsCatcher onPress={show} />}
      {notice !== null && (
        <View pointerEvents="none" style={styles.noticeSlot}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        </View>
      )}
      {isDrawn && (
        <Animated.View
          accessibilityElementsHidden={!isVisible}
          importantForAccessibility={isVisible ? 'auto' : 'no-hide-descendants'}
          style={[StyleSheet.absoluteFill, { opacity }]}
        >
          <View pointerEvents="none" style={styles.scrim} />
          <Controls
            audio={audio}
            onBack={onBack}
            onBottomHeight={setBottomHeight}
            onPicking={setPicking}
            isVisible={isVisible}
            onScrubbing={setScrubbing}
            subtitles={subtitles}
            title={title}
            transport={transport}
          />
        </Animated.View>
      )}
      {caption !== null && (
        <View
          pointerEvents="none"
          style={[
            styles.captionSlot,
            { paddingBottom: isVisible ? GUTTER + bottomHeight + TV_SIZES.space4 : GUTTER },
          ]}
        >
          <CaptionText caption={caption} fontSize={TV_SIZES.textLg} />
        </View>
      )}
    </View>
  )
}

const PlayerChrome = (props: PlayerChromeProps) => {
  const { title, surface, notice, onBack } = props
  if (surface === null) return <PlayerNotice notice={notice} onBack={onBack} title={title} />
  return <DpadPlayer {...props} surface={surface} />
}

/** The player on Android TV: raven's controls, which the d-pad drives, with raven's subtitles. */
export const dpadPlayerChrome: PlayerChromeKit = { PlayerChrome, shouldDrawCaptions: true }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOURS.ground },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: COLOURS.ground,
    opacity: SCRIM_OPACITY,
  },
  frame: { flex: 1, justifyContent: 'space-between', padding: GUTTER },
  title: { color: COLOURS.onPicture, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
  bottom: { gap: TV_SIZES.space3 },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
  time: { color: COLOURS.onPicture, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
  scrubberSlot: { flex: 1 },
  scrubber: { height: TV_SIZES.controlLarge, justifyContent: 'center' },
  line: {
    height: TV_SIZES.space1,
    borderRadius: TV_SIZES.space1,
    backgroundColor: COLOURS.track,
    overflow: 'hidden',
  },
  lineFocused: { height: TV_SIZES.space2 },
  played: { height: '100%', backgroundColor: COLOURS.accent },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB,
    backgroundColor: COLOURS.onPicture,
  },
  thumbFocused: {
    width: THUMB_FOCUSED,
    height: THUMB_FOCUSED,
    borderRadius: THUMB_FOCUSED,
    borderWidth: TV_SIZES.tvFocusRing,
    borderColor: COLOURS.accent,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: TV_SIZES.space3 },
  captionSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: GUTTER,
  },
  noticeSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  notice: {
    maxWidth: TV_SIZES.measure,
    color: COLOURS.onPicture,
    fontSize: TV_SIZES.textLg,
    textAlign: 'center',
  },
})
