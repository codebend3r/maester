import { type SkipStep, formatDuration } from '@raven/core'
import { Icon } from '@raven/native'
import { useClock, usePlayerPrefs } from '@raven/ui/headless'
import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentRef, useRef, useState } from 'react'
import {
  type AccessibilityActionInfo,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  View,
  useWindowDimensions,
} from 'react-native'

import { TouchFactChips } from '@/layouts/FactChips'
import { pickerLabelOf } from '@/layouts/gridKit'
import { openPickerSheet } from '@/layouts/Picker.touch'
import {
  PLAYER_COPY,
  type PlayerChromeProps,
  SKIP_DIRECTIONS,
  SKIP_ICONS,
  SKIP_SECONDS,
  type SkipDirection,
  type TrackPicker,
  type Transport,
  cornerFactsOf,
} from '@/layouts/playerKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { useScrub } from '@/layouts/useScrub'
import { VOLUME_ACTION_LIST, volumeAfterAction, volumeAtY, volumeIconOf } from '@/layouts/volumeKit'
import { SIZES } from '@/theme/appTheme'
import { useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'
import {
  ICON_SIZES,
  LOGO_HEIGHT,
  LOGO_WIDTH_SHARE,
  useTouchChromeStyles,
} from '@/layouts/PlayerChromeStyles.touch'

// The touch chrome's parts: the line, its buttons and skips, the volume, the track pickers, the title art and the corner.

/** The screen reader's actions a control may offer; the hint says what each does here. */
const ACCESSIBILITY_ACTIONS = { longPress: 'longpress' } as const

/** The screen reader's way to what a long press does. */
const HOLD_ACTIONS: AccessibilityActionInfo[] = [{ name: ACCESSIBILITY_ACTIONS.longPress }]

type ScrubberProps = Pick<Transport, 'position' | 'onSeek'> & { duration: number }

/**
 * Where the video is, as a line to drag along: the finger's spot shows as it moves and is sought
 * on letting go. VoiceOver reads it as the time of the length, and skips by a swipe.
 */
const Scrubber = ({ position, duration, onSeek }: ScrubberProps) => {
  const styles = useTouchChromeStyles()
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
export const IconButton = ({
  icon,
  label,
  size,
  isGlass = false,
  onPress,
  hold,
}: IconButtonProps) => {
  const styles = useTouchChromeStyles()
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
  const styles = useTouchChromeStyles()
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
  const styles = useTouchChromeStyles()
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
  const styles = useTouchChromeStyles()
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
  const styles = useTouchChromeStyles()
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
export const TransportControls = ({
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
  const styles = useTouchChromeStyles()
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
            icon={APP_ICONS.skipPrevious}
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
            icon={isPaused ? APP_ICONS.play : APP_ICONS.pause}
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
              icon={APP_ICONS.skipNext}
              label={next.label}
              onPress={next.onPlay}
              size={ICON_SIZES.transport}
            />
          )}
        </View>
        <View style={styles.run}>
          <VolumeControl isShown={isShown} />
          {subtitles !== null && (
            <PickerButton
              icon={APP_ICONS.captions}
              label={PLAYER_COPY.subtitles}
              picker={subtitles}
            />
          )}
          {audio !== null && (
            <PickerButton icon={APP_ICONS.headphones} label={PLAYER_COPY.audio} picker={audio} />
          )}
          {quality !== null && (
            <PickerButton icon={APP_ICONS.settings} label={PLAYER_COPY.quality} picker={quality} />
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
export const PlayerLogo = ({ heading, title }: PlayerLogoProps) => {
  const { width } = useWindowDimensions()
  const styles = useTouchChromeStyles()
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

type CornerProps = Pick<PlayerChromeProps, 'mode' | 'heading'>

/**
 * The top right corner, as the TV player's: the time of day, the picture's chips, then how the
 * video plays on a line of its own, read out together.
 */
export const Corner = ({ mode, heading }: CornerProps) => {
  const styles = useTouchChromeStyles()
  const { clock, chips, way, label } = cornerFactsOf({ mode, heading, clock: useClock() })
  return (
    <View accessibilityLabel={label} accessible style={styles.corner}>
      <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.clock}>
        {clock}
      </Text>
      {chips.length > 0 && <TouchFactChips parts={chips} />}
      {way !== null && (
        <View style={styles.wayChip}>
          <Text style={styles.wayText}>{way}</Text>
        </View>
      )}
    </View>
  )
}
