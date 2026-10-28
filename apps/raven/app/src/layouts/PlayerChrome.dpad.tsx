import { formatDuration } from '@raven/core'
import { type ComponentRef, type RefObject, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  StyleSheet,
  type TVRemoteEvent,
  View,
  useTVEventHandler,
} from 'react-native'
import Video from 'react-native-video'

import { Text } from '@/layouts/Text'
import { useFocusOnMount } from '@/layouts/focus'
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
import { useControlsLinger } from '@/layouts/useControlsLinger'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { pictureStyles } from '@/theme/useTheme'

const { Picker } = focusPicker

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** The thumb on the line, and how much it grows while the remote is on it. */
const THUMB = TV_SIZES.space4
const THUMB_FOCUSED = TV_SIZES.space6

type Focusable = RefObject<ComponentRef<typeof Pressable> | null>

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

type ScrubberProps = {
  view: Focusable
  transport: Transport
  onScrubbing: (isScrubbing: boolean) => void
}

/**
 * Where the video is, as a line the remote stands on: while it has the focus, left and right
 * skip ten seconds (the chrome hears them) and a press plays or pauses. It asks for the focus as
 * it appears and lets go once it has had it; on the player's first appearance the screen is
 * still sliding in, when only the preferred focus, set with the view, takes. TalkBack reads it as
 * the time of the length and skips by its own gesture.
 */
const Scrubber = ({ view, transport, onScrubbing }: ScrubberProps) => {
  const [isOpening, setOpening] = useState(true)
  const { position, onSeek, onTogglePlay } = transport
  const styles = useStyles()
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

type ControlsProps = Pick<
  PlayerChromeProps,
  'title' | 'transport' | 'audio' | 'subtitles' | 'onBack'
> & {
  /** Whether the controls are showing, not fading out: each time they come back the line asks for the focus. */
  isVisible: boolean
  onScrubbing: (isScrubbing: boolean) => void
  onPicking: (isPicking: boolean) => void
  onBottomHeight: (height: number) => void
}

/**
 * The controls over the video, dark in every theme as the web's: the title along the top; the
 * time and the line along the bottom, over play and pause, the track pickers and Back, on the
 * player's glass, with the lists they open. The line takes the remote's focus
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
}: ControlsProps) => {
  const scrubber: Focusable = useRef(null)
  const styles = useStyles()
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
                isOverPicture
                label={transport.isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
                onPress={transport.onTogglePlay}
                text={transport.isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
              />
            )}
            {audio !== null && (
              <Picker isOverPicture label={PLAYER_COPY.audio} onOpenChange={onPicking} {...audio} />
            )}
            {subtitles !== null && (
              <Picker
                isOverPicture
                label={PLAYER_COPY.subtitles}
                onOpenChange={onPicking}
                {...subtitles}
              />
            )}
            <PlateButton
              accessibilityRole="button"
              isOverPicture
              label={PLAYER_COPY.leave}
              onPress={onBack}
              text={PLAYER_COPY.leave}
            />
          </View>
        </FocusBand>
      </View>
    </View>
  )
}

type ControlsCatcherProps = { onPress: () => void }

/** While the controls are hidden, the one thing on screen to hold the remote's focus. */
const ControlsCatcher = ({ onPress }: ControlsCatcherProps) => {
  const catcher: Focusable = useRef(null)
  useFocusOnMount({ view: catcher })
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

type DpadPlayerProps = PlayerChromeProps & { surface: VideoSurface }

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
}: DpadPlayerProps) => {
  // Only the remote's handler reads whether the line has the focus, so it is no render's concern.
  const isScrubbing = useRef(false)
  const [isPicking, setPicking] = useState(false)
  const [bottomHeight, setBottomHeight] = useState(0)
  const styles = useStyles()
  const isPlaying = transport !== null && !transport.isPaused
  const { isVisible, isDrawn, opacity, show } = useControlsLinger({
    isPlaying,
    isHeld: isPicking,
  })

  // The line goes with the controls, and its blur may not be heard as it does.
  useEffect(() => {
    if (!isVisible) isScrubbing.current = false
  }, [isVisible])

  useRemote((event) => {
    const key = pressedKeyOf(event)
    if (key === null) return
    show()
    if (transport === null) return
    const { seekBy, shouldTogglePlay } = remoteAnswerOf({
      key,
      isShown: isVisible,
      isScrubbing: isScrubbing.current,
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
            onScrubbing={(isOnLine) => {
              isScrubbing.current = isOnLine
            }}
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
            { paddingBottom: isVisible ? TV_GUTTER + bottomHeight + TV_SIZES.space4 : TV_GUTTER },
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

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colours.ground },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colours.ground,
      opacity: SCRIM_OPACITY,
    },
    frame: { flex: 1, justifyContent: 'space-between', padding: TV_GUTTER },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    bottom: { gap: TV_SIZES.space3 },
    timeline: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
    time: { color: colours.text, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    scrubberSlot: { flex: 1 },
    scrubber: { height: TV_SIZES.controlLarge, justifyContent: 'center' },
    line: {
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
    },
    lineFocused: { height: TV_SIZES.space2 },
    played: { height: '100%', backgroundColor: colours.played },
    thumb: {
      position: 'absolute',
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB,
      backgroundColor: colours.text,
    },
    thumbFocused: {
      width: THUMB_FOCUSED,
      height: THUMB_FOCUSED,
      borderRadius: THUMB_FOCUSED,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: colours.played,
    },
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: TV_SIZES.space3 },
    captionSlot: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: TV_GUTTER,
    },
    noticeSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    notice: {
      maxWidth: TV_SIZES.measure,
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      textAlign: 'center',
    },
  }),
)
