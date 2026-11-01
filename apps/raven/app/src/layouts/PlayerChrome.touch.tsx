import { formatDuration } from '@raven/core'
import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentRef, useRef, useState } from 'react'
import {
  Animated,
  type GestureResponderEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Video from 'react-native-video'

import { pickerLabelOf } from '@/layouts/gridKit'
import { LoadingMark } from '@/layouts/LoadingMark'
import { openPickerSheet } from '@/layouts/Picker.touch'
import { CaptionText } from '@/layouts/PlayerCaption'
import {
  PLAYER_COPY,
  type PlayerChromeKit,
  type PlayerChromeProps,
  SKIP_SECONDS,
  type TrackPicker,
  type Transport,
  playedShareOf,
  scrubberAccessibilityOf,
  within,
} from '@/layouts/playerKit'
import { Text } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { useControlsLinger } from '@/layouts/useControlsLinger'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { pictureStyles, useTheme } from '@/theme/useTheme'

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** The scrubber's height: a finger's, though the line it draws is thin. */
const SCRUBBER_HEIGHT = 44

/** The web's icon sizes: its transport, its play and its glass pills. */
const ICON_SIZES = { transport: 24, play: 28, pill: 20 } as const

/** How tall the title art in the corner stands, and the share of the screen's width it may take. */
const LOGO_HEIGHT = SIZES.space6 * 1.5
const LOGO_WIDTH_SHARE = 0.4

type ScrubberProps = Pick<Transport, 'position' | 'onSeek'> & { duration: number }

/**
 * Where the video is, as a line to drag along: the finger's spot shows as it moves and is sought
 * on letting go. VoiceOver reads it as the time of the length, and skips by a swipe.
 */
const Scrubber = ({ position, duration, onSeek }: ScrubberProps) => {
  const [width, setWidth] = useState(0)
  const [dragged, setDragged] = useState<number | null>(null)
  const styles = useStyles()
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

type IconButtonProps = {
  icon: IconName
  label: string
  size: number
  isGlass?: boolean
  onPress: () => void
}

/** A round button wearing only the web's icon for it, said aloud by its label; glass where the web's is. */
const IconButton = ({ icon, label, size, isGlass = false, onPress }: IconButtonProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [styles.round, isGlass && styles.glass, pressed && styles.pressed]}
    >
      <Icon colour={colour} name={icon} size={size} />
    </Pressable>
  )
}

type PickerButtonProps = {
  icon: IconName
  label: string
  picker: TrackPicker
}

/** A track picker as a glass icon, said with its choice, opening the system's dark sheet beside it. */
const PickerButton = ({ icon, label, picker }: PickerButtonProps) => {
  const anchor = useRef<ComponentRef<typeof View>>(null)
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  const props = { ...picker, label, isOverPicture: true }
  return (
    <Pressable
      ref={anchor}
      accessibilityLabel={pickerLabelOf(props)}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={() => openPickerSheet({ ...props, anchor })}
      style={({ pressed }) => [styles.round, styles.glass, pressed && styles.pressed]}
    >
      <Icon colour={colour} name={icon} size={ICON_SIZES.pill} />
    </Pressable>
  )
}

type TransportControlsProps = Pick<
  PlayerChromeProps,
  'audio' | 'subtitles' | 'next' | 'onPictureInPicture'
> & { transport: Transport }

/**
 * The web's bar: the time over the line to drag along, then back to the start, back ten
 * seconds, play or pause, forward ten seconds and next, with the glass icons for subtitles,
 * audio and Picture in Picture at the right, wrapping under the transport on a narrow screen.
 */
const TransportControls = ({
  transport,
  audio,
  subtitles,
  next,
  onPictureInPicture,
}: TransportControlsProps) => {
  const { isPaused, position, duration, onTogglePlay, onSeek } = transport
  const length = duration ?? 0
  const styles = useStyles()
  return (
    <View style={styles.bottom}>
      <View style={styles.timeline}>
        <Text style={styles.time}>{formatDuration(position)}</Text>
        <View style={styles.scrubberSlot}>
          <Scrubber duration={length} onSeek={onSeek} position={position} />
        </View>
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </View>
      <View style={styles.bar}>
        <View style={styles.run}>
          <IconButton
            icon="skipPrevious"
            label={PLAYER_COPY.restart}
            onPress={() => onSeek(0)}
            size={ICON_SIZES.transport}
          />
          <IconButton
            icon="rewind"
            label={PLAYER_COPY.back(SKIP_SECONDS)}
            onPress={() => onSeek(position - SKIP_SECONDS)}
            size={ICON_SIZES.transport}
          />
          <IconButton
            icon={isPaused ? 'play' : 'pause'}
            label={isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
            onPress={onTogglePlay}
            size={ICON_SIZES.play}
          />
          <IconButton
            icon="forward"
            label={PLAYER_COPY.forward(SKIP_SECONDS)}
            onPress={() => onSeek(position + SKIP_SECONDS)}
            size={ICON_SIZES.transport}
          />
          {next !== null && (
            <IconButton
              icon="skipNext"
              label={next.label}
              onPress={next.onPlay}
              size={ICON_SIZES.transport}
            />
          )}
        </View>
        <View style={styles.run}>
          {subtitles !== null && (
            <PickerButton icon="captions" label={PLAYER_COPY.subtitles} picker={subtitles} />
          )}
          {audio !== null && (
            <PickerButton icon="headphones" label={PLAYER_COPY.audio} picker={audio} />
          )}
          {onPictureInPicture !== null && (
            <IconButton
              icon="resize"
              isGlass
              label={PLAYER_COPY.pictureInPicture}
              onPress={onPictureInPicture}
              size={ICON_SIZES.pill}
            />
          )}
        </View>
      </View>
    </View>
  )
}

type PlayerLogoProps = Pick<PlayerChromeProps, 'heading' | 'title'>

/**
 * What is playing, in the top left corner, fading in and out with the controls: the show's or the
 * film's title art, or its name where there is none, and an episode's season and number under it.
 */
const PlayerLogo = ({ heading, title }: PlayerLogoProps) => {
  const { width } = useWindowDimensions()
  const styles = useStyles()
  const name = heading.show ?? (heading.title === '' ? title : heading.title)
  return (
    name !== '' && (
      <View accessibilityRole="header" style={styles.logo}>
        <TitleArt
          height={LOGO_HEIGHT}
          logo={heading.logo}
          maxWidth={width * LOGO_WIDTH_SHARE}
          name={name}
          textStyle={styles.title}
        />
        {heading.place !== null && <Text style={styles.place}>{heading.place}</Text>}
      </View>
    )
  )
}

/**
 * Raven's controls over the video under the thumb, the web player's, in icons: Back at the top
 * right, and along the bottom the time and the line to drag along, then the transport and the
 * glass icons for subtitles, audio and Picture in Picture, all inside the safe area while the
 * video fills the screen. They fade once the video has played untouched for the viewer's linger,
 * and a tap brings them back; what is playing, in the top left corner, fades with them. The
 * video plays in Picture in Picture when the app is left, and on AirPlay; the silent switch never
 * mutes it, and leaving the app without Picture in Picture pauses it.
 */
const PlayerChrome = ({
  title,
  heading,
  surface,
  notice,
  isOpening,
  caption,
  transport,
  audio,
  subtitles,
  next,
  onPictureInPicture,
  onBack,
}: PlayerChromeProps) => {
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  const isPlaying = transport !== null && !transport.isPaused
  const { isVisible, opacity, stir, toggle } = useControlsLinger({ isPlaying })
  const sides = {
    paddingTop: insets.top + SIZES.space2,
    paddingBottom: insets.bottom + SIZES.space2,
    paddingLeft: Math.max(insets.left, SIZES.space4),
    paddingRight: Math.max(insets.right, SIZES.space4),
  }
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" hidden={!isVisible} />
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
        onPress={toggle}
        style={StyleSheet.absoluteFill}
      />
      {isOpening && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LoadingMark
            gap={SIZES.space4}
            isOverPicture
            label={PLAYER_COPY.opening}
            markWidth={SIZES.space6 * 2}
          />
        </View>
      )}
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
        <View pointerEvents="none" style={[styles.logoSlot, sides]}>
          <PlayerLogo heading={heading} title={title} />
        </View>
        <View pointerEvents="box-none" style={[styles.frame, sides]}>
          <View style={styles.top}>
            <IconButton
              icon="back"
              isGlass
              label={PLAYER_COPY.leave}
              onPress={onBack}
              size={ICON_SIZES.pill}
            />
          </View>
          {transport !== null && (
            <TransportControls
              audio={audio}
              next={next}
              onPictureInPicture={onPictureInPicture}
              subtitles={subtitles}
              transport={transport}
            />
          )}
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
export const touchPlayerChrome: PlayerChromeKit = {
  PlayerChrome,
  shouldDrawCaptions: true,
  canDrawPictureSubtitles: false,
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colours.ground },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colours.ground,
      opacity: SCRIM_OPACITY,
    },
    frame: { flex: 1, justifyContent: 'space-between' },
    top: { alignItems: 'flex-end' },
    logoSlot: { ...StyleSheet.absoluteFill, alignItems: 'flex-start' },
    logo: { gap: SIZES.space1 },
    // The name where there is no art, over any picture, so a shadow keeps it readable unfaded.
    title: {
      color: colours.text,
      fontSize: SIZES.textLg,
      fontWeight: '600',
      textShadowColor: colours.ground,
      textShadowRadius: SIZES.space2,
    },
    place: {
      color: colours.text,
      fontSize: SIZES.textSm,
      textShadowColor: colours.ground,
      textShadowRadius: SIZES.space2,
    },
    bottom: { gap: SIZES.space1 },
    timeline: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
    bar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SIZES.space2,
    },
    run: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space1 },
    time: { color: colours.text, fontSize: SIZES.textSm, fontVariant: ['tabular-nums'] },
    scrubberSlot: { flex: 1 },
    scrubber: { height: SCRUBBER_HEIGHT, justifyContent: 'center' },
    line: {
      height: SIZES.space1,
      borderRadius: SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
    },
    played: { height: '100%', backgroundColor: colours.played },
    thumb: {
      position: 'absolute',
      width: SIZES.space4,
      height: SIZES.space4,
      marginLeft: -SIZES.space4 / 2,
      borderRadius: SIZES.space4,
      backgroundColor: colours.text,
    },
    round: {
      width: SIZES.controlLarge,
      height: SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.controlLarge,
    },
    // The web's pills and back: dark glass, the same in every theme.
    glass: { backgroundColor: colours.quiet },
    pressed: { opacity: OPACITIES.pressed },
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
      color: colours.text,
      fontSize: SIZES.text,
      textAlign: 'center',
    },
  }),
)
