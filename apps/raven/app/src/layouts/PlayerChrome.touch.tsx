import { type SkipStep, formatDuration } from '@raven/core'
import { Icon } from '@raven/native'
import { usePlayerPrefs } from '@raven/ui/headless'
import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentRef, useRef, useState } from 'react'
import {
  type AccessibilityActionInfo,
  Animated,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
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
import { HoldMark, SkipMark } from '@/layouts/PlayerMark.touch'
import {
  PLAYER_COPY,
  type PlayerChromeKit,
  type PlayerChromeProps,
  SKIP_DIRECTIONS,
  SKIP_ICONS,
  SKIP_SECONDS,
  type SkipDirection,
  type TrackPicker,
  type Transport,
} from '@/layouts/playerKit'
import { Text } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { useControlsLinger } from '@/layouts/useControlsLinger'
import { useScrub } from '@/layouts/useScrub'
import { useSkipLadder } from '@/layouts/useSkipLadder'
import { heldPlaybackOf, useSurfaceGestures } from '@/layouts/useSurfaceGestures'
import { VOLUME_ACTION_LIST, volumeAfterAction, volumeAtY, volumeIconOf } from '@/layouts/volumeKit'
import { usePlayerKeys } from '@/player/usePlayerKeys'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { pictureStyles, useTheme } from '@/theme/useTheme'

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** The scrubber's height: a finger's, though the line it draws is thin. */
const SCRUBBER_HEIGHT = 44

/** The web's icon sizes: its transport, its play and its glass pills. */
const ICON_SIZES = { transport: 24, play: 28, pill: 20, skip: 32 } as const

/** The vertical volume slider's track: a field wide, six fields tall, standing over its speaker. */
const VOLUME_TRACK = { width: SIZES.fieldHeight, height: SIZES.fieldHeight * 6 } as const

/** The screen reader's actions a control may offer; the hint says what each does here. */
const ACCESSIBILITY_ACTIONS = { longPress: 'longpress' } as const

/** The screen reader's way to what a long press does. */
const HOLD_ACTIONS: AccessibilityActionInfo[] = [{ name: ACCESSIBILITY_ACTIONS.longPress }]

/** How tall the title art in the corner stands, and the share of the screen's width it may take. */
const LOGO_HEIGHT = SIZES.space6 * 1.5
const LOGO_WIDTH_SHARE = 0.4

type ScrubberProps = Pick<Transport, 'position' | 'onSeek'> & { duration: number }

/**
 * Where the video is, as a line to drag along: the finger's spot shows as it moves and is sought
 * on letting go. VoiceOver reads it as the time of the length, and skips by a swipe.
 */
const Scrubber = ({ position, duration, onSeek }: ScrubberProps) => {
  const styles = useStyles()
  const { share, lineProps } = useScrub({ position, duration, onSeek, inset: 0, canDrag: true })
  return (
    <View {...lineProps} style={styles.scrubber}>
      <View pointerEvents="none" style={styles.line}>
        <View style={[styles.played, { width: share }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: share }]} />
    </View>
  )
}

/** What a long press on a button does, and how the screen reader is told of it. */
type Hold = { hint: string; onHold: () => void }

type HoldProps = Pick<
  PressableProps,
  'accessibilityActions' | 'accessibilityHint' | 'onAccessibilityAction' | 'onLongPress'
>

/** The long press and the screen reader's action for it, or nothing for a button with no hold. */
const holdPropsOf = (hold: Hold | undefined): HoldProps =>
  hold === undefined
    ? {}
    : {
        accessibilityActions: HOLD_ACTIONS,
        accessibilityHint: hold.hint,
        onAccessibilityAction: hold.onHold,
        onLongPress: hold.onHold,
      }

type IconButtonProps = {
  icon: IconName
  label: string
  size: number
  isGlass?: boolean
  onPress: () => void
  /** A second way the button is used, by holding it; the screen reader offers it as an action. */
  hold?: Hold
}

/** A round button wearing only the web's icon for it, said aloud by its label; glass where the web's is. */
const IconButton = ({ icon, label, size, isGlass = false, onPress, hold }: IconButtonProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  return (
    <Pressable
      {...holdPropsOf(hold)}
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

type SkipButtonProps = { direction: SkipDirection; label: string; onPress: () => void }

/** A skip as Plex draws it: a circle open at the top with an arrowhead, the seconds set inside. */
const SkipButton = ({ direction, label, onPress }: SkipButtonProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      <View style={styles.skipIcon}>
        <Icon colour={colour} name={SKIP_ICONS[direction]} size={ICON_SIZES.skip} />
        <Text style={styles.skipSeconds}>{String(SKIP_SECONDS)}</Text>
      </View>
    </Pressable>
  )
}

type VolumeSliderProps = { shown: number; onVolume: (volume: number) => void }

/**
 * The volume as a line standing up, on a glass plate over its speaker: full at the top, silent at
 * the foot, set by a finger anywhere on it. VoiceOver reads it as a percentage and moves it by a
 * swipe.
 */
const VolumeSlider = ({ shown, onVolume }: VolumeSliderProps) => {
  const [height, setHeight] = useState(0)
  const styles = useStyles()
  const drag = (event: GestureResponderEvent) =>
    onVolume(volumeAtY({ y: event.nativeEvent.locationY, height }))
  const share: `${number}%` = `${shown * 100}%`
  return (
    <View
      accessible
      accessibilityActions={VOLUME_ACTION_LIST}
      accessibilityLabel={PLAYER_COPY.volume}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      onAccessibilityAction={({ nativeEvent }) =>
        onVolume(volumeAfterAction({ volume: shown, name: nativeEvent.actionName }))
      }
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={drag}
      onResponderMove={drag}
      onStartShouldSetResponder={() => true}
      style={styles.volumeSlider}
    >
      <View pointerEvents="none" style={styles.upright}>
        <View style={[styles.filled, { height: share }]} />
      </View>
      <View pointerEvents="none" style={[styles.uprightThumb, { bottom: share }]} />
    </View>
  )
}

type VolumeControlProps = {
  /** Whether the controls are up: the slider goes with them. */
  isShown: boolean
}

/**
 * The speaker, which mutes, in a slot of its own width. Held, it opens the volume slider standing
 * over it, which a second hold, or the controls going, puts away; so the slider never lies over
 * the glass icons beside it, as the web's horizontal one did at full volume.
 */
const VolumeControl = ({ isShown }: VolumeControlProps) => {
  const [isOpen, setOpen] = useState(false)
  const [wasShown, setWasShown] = useState(isShown)
  const styles = useStyles()
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  // The slider goes with the controls, settled as they change rather than a render later.
  if (wasShown !== isShown) {
    setWasShown(isShown)
    if (!isShown) setOpen(false)
  }
  const shown = isMuted ? 0 : volume
  return (
    <View style={styles.volumeSlot}>
      {isOpen && (
        <View style={styles.volumePlate}>
          <VolumeSlider
            onVolume={(next) => setVolume({ volume: next, muted: false })}
            shown={shown}
          />
        </View>
      )}
      <IconButton
        hold={{ hint: PLAYER_COPY.volumeHint, onHold: () => setOpen((open) => !open) }}
        icon={volumeIconOf({ volume, isMuted })}
        label={isMuted ? PLAYER_COPY.unmute : PLAYER_COPY.mute}
        onPress={() => setVolume({ volume, muted: !isMuted })}
        size={ICON_SIZES.pill}
      />
    </View>
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
  'audio' | 'subtitles' | 'quality' | 'next' | 'previous'
> & {
  transport: Transport
  isShown: boolean
  /** A skip either way, by the chrome's one ladder. */
  onSkip: (direction: SkipStep['direction']) => void
}

/**
 * The web's bar: the time over the line to drag along, then back to the start, skip back, play
 * or pause, skip forward (ten seconds, further when pressed quickly) and next, with the glass icons for subtitles,
 * audio and quality at the right, wrapping under the transport on a narrow screen. iOS plays
 * full screen and enters Picture in Picture by itself as the app is left, so there is no
 * button for either.
 */
const TransportControls = ({
  transport,
  audio,
  subtitles,
  quality,
  next,
  previous,
  isShown,
  onSkip,
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
            label={previous?.label ?? PLAYER_COPY.restart}
            onPress={previous?.onPlay ?? (() => onSeek(0))}
            size={ICON_SIZES.transport}
          />
          <SkipButton
            direction={SKIP_DIRECTIONS.back}
            label={PLAYER_COPY.back(SKIP_SECONDS)}
            onPress={() => onSkip(-1)}
          />
          <IconButton
            icon={isPaused ? 'play' : 'pause'}
            label={isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
            onPress={onTogglePlay}
            size={ICON_SIZES.play}
          />
          <SkipButton
            direction={SKIP_DIRECTIONS.forward}
            label={PLAYER_COPY.forward(SKIP_SECONDS)}
            onPress={() => onSkip(1)}
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
          <VolumeControl isShown={isShown} />
          {subtitles !== null && (
            <PickerButton icon="captions" label={PLAYER_COPY.subtitles} picker={subtitles} />
          )}
          {audio !== null && (
            <PickerButton icon="headphones" label={PLAYER_COPY.audio} picker={audio} />
          )}
          {quality !== null && (
            <PickerButton icon="settings" label={PLAYER_COPY.quality} picker={quality} />
          )}
        </View>
      </View>
    </View>
  )
}

type PlayerLogoProps = Pick<PlayerChromeProps, 'heading' | 'title'>

/**
 * What is playing, beside Back in the top left corner, fading in and out with the controls: the
 * show's or the film's title art, or its name where there is none, and an episode's season and
 * number under it.
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
 * left with what is playing beside it, and along the bottom the time and the line to drag along, then the transport and the
 * glass icons for subtitles, audio, quality and Picture in Picture, all inside the safe area
 * while the video fills the screen. They fade once the video has played untouched for the
 * viewer's linger, and a tap brings them back; what is playing fades with them. A double tap on
 * the picture's right half skips forward and on its left half back, and a finger held there
 * plays on at twice the speed or runs back at it. Every skip, a button's, a key's or a tap's,
 * climbs one ladder: 10 seconds, then 20 and 30 when they come quickly. A hardware
 * keyboard drives it as it drives the web's player, each key bringing the controls back as a tap
 * does. The video plays in Picture in Picture when the app is left, and on AirPlay; the silent
 * switch never mutes it, and leaving the app without Picture in Picture pauses it.
 */
const PlayerChrome = ({
  title,
  heading,
  surface,
  notice,
  isOpening,
  caption,
  captionStyle,
  transport,
  audio,
  subtitles,
  quality,
  next,
  previous,
  onBack,
}: PlayerChromeProps) => {
  const insets = useSafeAreaInsets()
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const styles = useStyles()
  const isPlaying = transport !== null && !transport.isPaused
  const { isVisible, opacity, stir, show, toggle } = useControlsLinger({ isPlaying })
  const { width } = useWindowDimensions()
  const skip = useSkipLadder({ transport })
  // The last skip's mark, counted so the same one twice starts afresh.
  const [skipped, setSkipped] = useState<{ step: SkipStep; count: number } | null>(null)
  const skipBy = (direction: SkipStep['direction']) => {
    const step = skip(direction)
    if (step !== null) setSkipped((was) => ({ step, count: (was?.count ?? 0) + 1 }))
  }
  const gestures = useSurfaceGestures({
    transport,
    width,
    onSkip: skipBy,
    // Paused, opening or ended the controls stay up, so a tap has nothing to show or hide.
    onTap: () => {
      if (isPlaying) toggle()
    },
  })
  usePlayerKeys({ transport, subtitles, onBack, onSkip: skipBy, onPress: show })
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
          muted={isMuted}
          {...heldPlaybackOf({ surface, held: gestures.held })}
          playInBackground={false}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
          volume={volume}
        />
      )}
      <Pressable
        {...gestures.surfaceProps}
        accessibilityLabel={isVisible ? PLAYER_COPY.hideControls : PLAYER_COPY.showControls}
        accessibilityRole="button"
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
        <View pointerEvents="box-none" style={[styles.frame, sides]}>
          <View pointerEvents="box-none" style={styles.top}>
            <IconButton
              icon="back"
              isGlass
              label={PLAYER_COPY.leave}
              onPress={onBack}
              size={ICON_SIZES.pill}
            />
            <View pointerEvents="none" style={styles.logoSlot}>
              <PlayerLogo heading={heading} title={title} />
            </View>
          </View>
          {gestures.transport !== null && (
            <TransportControls
              audio={audio}
              isShown={isVisible}
              next={next}
              onSkip={skipBy}
              previous={previous}
              quality={quality}
              subtitles={subtitles}
              transport={gestures.transport}
            />
          )}
        </View>
      </Animated.View>
      {skipped !== null && gestures.held === null && (
        <SkipMark key={skipped.count} sides={sides} step={skipped.step} />
      )}
      {gestures.held !== null && <HoldMark side={gestures.held} sides={sides} />}
      {caption !== null && (
        <View pointerEvents="none" style={[styles.captionSlot, sides]}>
          <CaptionText caption={caption} look={captionStyle} />
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
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: SIZES.space3 },
    // Beside Back, its art centred on the button's height until the art stands taller.
    logoSlot: { flexShrink: 1, minHeight: SIZES.controlLarge, justifyContent: 'center' },
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
    skipIcon: {
      width: ICON_SIZES.skip,
      height: ICON_SIZES.skip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The circle's centre sits a little below the icon's, so the seconds do too.
    skipSeconds: {
      position: 'absolute',
      color: colours.text,
      fontSize: SIZES.textXs,
      fontWeight: 'bold',
      marginTop: SIZES.space0,
    },
    // The speaker's slot: one control wide, so the slider over it never lies over a neighbour.
    volumeSlot: {
      width: SIZES.controlLarge,
      height: SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The slider's glass plate, standing over the speaker with a gap between them.
    volumePlate: {
      position: 'absolute',
      bottom: SIZES.controlLarge + SIZES.space2,
      padding: SIZES.space2,
      borderRadius: SIZES.space3,
      backgroundColor: colours.quiet,
    },
    volumeSlider: { ...VOLUME_TRACK, alignItems: 'center', justifyContent: 'flex-end' },
    upright: {
      width: SIZES.space1,
      height: '100%',
      borderRadius: SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    filled: { width: '100%', backgroundColor: colours.played },
    uprightThumb: {
      position: 'absolute',
      width: SIZES.space4,
      height: SIZES.space4,
      marginBottom: -SIZES.space4 / 2,
      borderRadius: SIZES.space4,
      backgroundColor: colours.text,
    },
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
