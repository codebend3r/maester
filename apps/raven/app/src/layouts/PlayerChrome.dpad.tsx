import { type SkipStep, formatDuration } from '@raven/core'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import {
  Animated,
  PixelRatio,
  Pressable,
  StyleSheet,
  type TVRemoteEvent,
  useTVEventHandler,
  View,
} from 'react-native'
import Video from 'react-native-video'

import { Text } from '@/layouts/Text'
import {
  type Flash,
  type ShownMark,
  flashOfSkip,
  flashOfToggle,
  shownMarkOf,
} from '@/layouts/centreMark'
import { useFocusOnMount } from '@/layouts/focus'
import { FocusBand } from '@/layouts/FocusBand'
import { CaptionText } from '@/layouts/PlayerCaption'
import { OpeningMark, PlayerNotice } from '@/layouts/PlayerNotice.focus'
import { ChaptersBand } from '@/layouts/PlayerChapters.dpad'
import { UpNextCard, useUpNextOffer } from '@/layouts/PlayerUpNext.dpad'
import {
  PLAYER_COPY,
  SKIP_DIRECTIONS,
  SKIP_ICONS,
  SKIP_SECONDS,
  SURFACE_STATES,
  type PlayerChromeKit,
  type PlayerChromeProps,
  type SurfaceState,
  surfaceStateOf,
  type VideoSurface,
} from '@/layouts/playerKit'
import {
  REMOTE_HOLDERS,
  isSeekingWith,
  pressedKeyOf,
  remoteAnswerOf,
  remoteHolderOf,
} from '@/layouts/remoteKeys'
import { PlateButton } from '@/layouts/tvControls'
import { requestTVFocus } from '@/layouts/tvFocus'
import { useControlsLinger } from '@/layouts/useControlsLinger'
import { TV_CAPTION_BASE } from '@/player/captionLook'
import { useHeldSeek } from '@/layouts/useHeldSeek'
import { useSkipLadder } from '@/layouts/useSkipLadder'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { APP_ICONS } from '@/theme/icons'
import { useDpadChromeStyles } from '@/layouts/PlayerChromeStyles.dpad'
import {
  type Focusable,
  Scrubber,
  TrackButton,
  Corner,
  Centre,
  Heading,
} from '@/layouts/PlayerParts.dpad'

/** What hears each of the remote's presses. */
type RemoteResponder = (event: TVRemoteEvent) => void

/**
 * Hears the remote through the fork's `useTVEventHandler`, which subscribes again whenever its
 * listener changes; one listener for the chrome's life reads the latest answer instead.
 */
const useRemote = (respond: RemoteResponder) => {
  const latest = useRef(respond)
  useEffect(() => {
    latest.current = respond
  })
  const [listener] = useState(() => (event: TVRemoteEvent) => latest.current(event))
  useTVEventHandler(listener)
}

type ControlsProps = Pick<
  PlayerChromeProps,
  | 'heading'
  | 'transport'
  | 'audio'
  | 'subtitles'
  | 'quality'
  | 'next'
  | 'previous'
  | 'mode'
  | 'chapters'
  | 'onBack'
> & {
  /** Whether the remote is the controls': each time it comes to them the line asks for the focus. */
  hasRemote: boolean
  /** A skip either way, by the chrome's one ladder. */
  onSkip: (direction: SkipStep['direction']) => void
  onScrubbing: (isScrubbing: boolean) => void
  onPicking: (isPicking: boolean) => void
  onBottomHeight: (height: number) => void
}

type LiftedSubtitleStyleOfProps = {
  style: VideoSurface['subtitleStyle']
  /** How far the controls reach up from the bottom of the screen, in points; 0 while hidden. */
  lift: number
}

/**
 * The player's own subtitles, where it draws them, raised clear of the controls while they
 * show. The player takes its padding in pixels; a platform whose player draws none has no style.
 */
const liftedSubtitleStyleOf = ({
  style,
  lift,
}: LiftedSubtitleStyleOfProps): VideoSurface['subtitleStyle'] =>
  style === undefined
    ? undefined
    : { ...style, paddingBottom: PixelRatio.getPixelSizeForLayoutSize(lift) }

/**
 * The controls over the video, dark in every theme as the web's: Back at the top left, then the
 * title; the time and the line along the bottom, over back to the start, skip back, play and
 * pause, skip forward and the next episode or film at the left, and the audio, subtitle and
 * quality pickers at the right, on the player's glass, with the lists they open. The line takes
 * the remote's focus as they appear, so a press of left or right goes on skipping; the buttons
 * are a band, so Down from the line lands on the first of them rather than on the one under the
 * thumb, and Back is a band of its own, so Up from anywhere below reaches it.
 */
const Controls = ({
  heading,
  transport,
  audio,
  subtitles,
  quality,
  next,
  previous,
  mode,
  chapters,
  onBack,
  onScrubbing,
  onPicking,
  onBottomHeight,
  onSkip,
  hasRemote,
}: ControlsProps) => {
  const scrubber: Focusable = useRef(null)
  const styles = useDpadChromeStyles()
  // The chapters open as the remote reaches their strip below the buttons, and fold as it goes back up.
  const [isChaptersOpen, setChaptersOpen] = useState(false)
  /*
   * Brought back while they fade out, the controls are still drawn, and the hidden state's
   * catcher, which had the focus, goes: the line asks again. While the up next card is offered
   * its Play now has the remote, and the line takes it back as the card goes.
   */
  useEffect(() => {
    if (hasRemote) requestTVFocus(scrubber.current)
  }, [hasRemote])
  return (
    <View style={styles.frame}>
      <View style={styles.top}>
        <View style={styles.topStart}>
          <FocusBand>
            <PlateButton
              icon={APP_ICONS.back}
              isOverPicture
              label={PLAYER_COPY.leave}
              onPress={onBack}
            />
          </FocusBand>
          <Heading heading={heading} />
        </View>
        <Corner mode={mode} heading={heading} />
      </View>
      <View
        onLayout={({ nativeEvent }) => onBottomHeight(nativeEvent.layout.height)}
        style={styles.bottom}
      >
        {transport !== null && (
          <View onFocus={() => setChaptersOpen(false)} style={styles.timeline}>
            <Text style={styles.time}>{formatDuration(transport.position)}</Text>
            <View style={styles.scrubberSlot}>
              <Scrubber
                chapters={chapters}
                onScrubbing={onScrubbing}
                transport={transport}
                view={scrubber}
              />
            </View>
            <Text style={styles.time}>{formatDuration(transport.duration)}</Text>
          </View>
        )}
        <FocusBand>
          <View onFocus={() => setChaptersOpen(false)} style={styles.buttons}>
            <View style={styles.buttonGroup}>
              {transport !== null && (
                <>
                  <PlateButton
                    icon={APP_ICONS.skipPrevious}
                    isOverPicture
                    label={previous?.label ?? PLAYER_COPY.restart}
                    onPress={previous?.onPlay ?? (() => transport.onSeek(0))}
                  />
                  <PlateButton
                    icon={SKIP_ICONS[SKIP_DIRECTIONS.back]}
                    isOverPicture
                    label={PLAYER_COPY.back(SKIP_SECONDS)}
                    onPress={() => onSkip(-1)}
                    text={String(SKIP_SECONDS)}
                  />
                  <PlateButton
                    icon={transport.isPaused ? APP_ICONS.play : APP_ICONS.pause}
                    isOverPicture
                    label={transport.isPaused ? PLAYER_COPY.play : PLAYER_COPY.pause}
                    onPress={transport.onTogglePlay}
                  />
                  <PlateButton
                    icon={SKIP_ICONS[SKIP_DIRECTIONS.forward]}
                    isOverPicture
                    label={PLAYER_COPY.forward(SKIP_SECONDS)}
                    onPress={() => onSkip(1)}
                    text={String(SKIP_SECONDS)}
                  />
                </>
              )}
              {next !== null && (
                <PlateButton
                  icon={APP_ICONS.skipNext}
                  isOverPicture
                  label={next.label}
                  onPress={next.onPlay}
                />
              )}
            </View>
            <View style={styles.buttonGroup}>
              {audio !== null && (
                <TrackButton
                  icon={APP_ICONS.volume}
                  label={PLAYER_COPY.audio}
                  onPicking={onPicking}
                  picker={audio}
                />
              )}
              {subtitles !== null && (
                <TrackButton
                  icon={APP_ICONS.captions}
                  label={PLAYER_COPY.subtitles}
                  onPicking={onPicking}
                  picker={subtitles}
                />
              )}
              {quality !== null && (
                <TrackButton
                  icon={APP_ICONS.settings}
                  label={PLAYER_COPY.quality}
                  onPicking={onPicking}
                  picker={quality}
                />
              )}
            </View>
          </View>
        </FocusBand>
        {transport !== null && (
          <ChaptersBand
            chapters={chapters}
            isOpen={isChaptersOpen}
            onChoose={(start) => {
              transport.onSeek(start)
              setChaptersOpen(false)
              requestTVFocus(scrubber.current)
            }}
            onOpen={() => setChaptersOpen(true)}
            position={transport.position}
          />
        )}
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

type ShownKeyOfProps = ShownMark & { count: number }

/** What tells one showing of the middle mark from the next: a flash counts, so the same twice starts afresh. */
const shownKeyOf = ({ mark, isFading, count }: ShownKeyOfProps): string =>
  isFading ? `${mark}:${count}` : mark

type DpadPlayerProps = PlayerChromeProps

/** The last press's flash in the middle, counted so the same one twice starts afresh. */
type CountedFlash = Flash & { count: number }

/**
 * raven's own controls over ExoPlayer, driven by the d-pad. They fade once the video has played
 * untouched for the viewer's linger, and any key brings them back; they stay up while it is
 * paused, opening or ended, while a picker's list is open, and while left or right is held,
 * until the key comes up and the video plays on. The middle of the picture says what each press
 * did: a skip's way and a play flash and fade, the pause stays while the video is paused. Hidden, left and right still skip
 * ten seconds, and the remote's play, rewind and fast forward keys work wherever the focus is.
 * The subtitles stand over the video whether or not the controls are, clear of them while they
 * show: raven's own cues on Apple TV, the player's on Android TV. From the credits on, the up
 * next card stands at the bottom right, hidden controls or not, with the remote on its Play now.
 */
const DpadPlayer = ({
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
  mode,
  credits,
  chapters,
  onBack,
}: DpadPlayerProps) => {
  // Only the remote's handler reads whether the line has the focus, so it is no render's concern.
  const isScrubbing = useRef(false)
  const [isPicking, setPicking] = useState(false)
  const [bottomHeight, setBottomHeight] = useState(0)
  const styles = useDpadChromeStyles()
  const isPlaying = transport !== null && !transport.isPaused
  // The last press's flash, counted so the same one twice starts afresh.
  const [flash, setFlash] = useState<CountedFlash | null>(null)
  const flashOf = (flashed: Flash | null) => {
    if (flashed !== null) setFlash((was) => ({ ...flashed, count: (was?.count ?? 0) + 1 }))
  }
  // Every skip, the remote's keys and the plates alike, climbs one ladder: 10, then 20 and 30.
  const skip = useSkipLadder({ transport })
  const skipBy = (direction: SkipStep['direction']) => {
    const step = skip(direction)
    if (step !== null) flashOf(flashOfSkip(step))
  }
  // Whether the remote is on drawn buttons, as its handler reads it when a key goes down.
  const isOnButtonsNow = useRef(false)
  const held = useHeldSeek({
    transport,
    isSeeking: () =>
      isSeekingWith({ isShown: isOnButtonsNow.current, isScrubbing: isScrubbing.current }),
  })
  const { isVisible, isDrawn, opacity, show } = useControlsLinger({
    isPlaying,
    isHeld: isPicking || held.isHolding,
  })
  const offer = useUpNextOffer({ next, transport, credits })
  // On the card's buttons, as on the controls', left and right move the focus rather than seek.
  const holder = remoteHolderOf({ isVisible, isUpNextOffered: offer !== null })
  const isOnButtons = holder !== REMOTE_HOLDERS.catcher

  // The line goes with the controls, and its blur may not be heard as it does.
  useEffect(() => {
    isOnButtonsNow.current = isOnButtons
    if (!isVisible) isScrubbing.current = false
  }, [isVisible, isOnButtons])

  useRemote((event) => {
    if (held.respond(event)) {
      show()
      return
    }
    const key = pressedKeyOf(event)
    if (key === null) return
    show()
    if (transport === null) return
    const { skip: way, shouldTogglePlay } = remoteAnswerOf({
      key,
      isShown: isOnButtons,
      isScrubbing: isScrubbing.current,
      isPaused: transport.isPaused,
    })
    if (way !== null) skipBy(way)
    if (!shouldTogglePlay) return
    flashOf(flashOfToggle(transport.isPaused))
    transport.onTogglePlay()
  })

  // Play and Pause on the plate and a press on the line flash as the remote's keys do.
  const controlled =
    held.transport === null
      ? null
      : {
          ...held.transport,
          onTogglePlay: () => {
            flashOf(flashOfToggle(held.transport?.isPaused ?? false))
            held.transport?.onTogglePlay()
          },
        }
  const shown = shownMarkOf({
    isPaused: transport?.isPaused ?? false,
    held: held.direction,
    flash,
  })
  const shownKey = shown === null ? null : shownKeyOf({ ...shown, count: flash?.count ?? 0 })
  // How far the subtitles, raven's cues or the player's own, rise to stand clear of the controls.
  const lift = isVisible ? bottomHeight + TV_SIZES.space4 : 0

  return (
    <View style={styles.root}>
      {surface !== null && (
        <Video
          {...surface}
          controls={false}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
          subtitleStyle={liftedSubtitleStyleOf({
            style: surface.subtitleStyle,
            lift,
          })}
        />
      )}
      {isOpening && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <OpeningMark />
        </View>
      )}
      {holder === REMOTE_HOLDERS.catcher && <ControlsCatcher onPress={show} />}
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
            heading={heading}
            mode={mode}
            next={next}
            previous={previous}
            onBack={onBack}
            onBottomHeight={setBottomHeight}
            onPicking={setPicking}
            onSkip={skipBy}
            quality={quality}
            hasRemote={holder === REMOTE_HOLDERS.controls}
            onScrubbing={(isOnLine) => {
              isScrubbing.current = isOnLine
            }}
            subtitles={subtitles}
            transport={controlled}
            chapters={chapters}
          />
        </Animated.View>
      )}
      {shown !== null && shownKey !== null && <Centre key={shownKey} {...shown} />}
      {offer !== null && <UpNextCard lift={lift} offer={offer} />}
      {caption !== null && (
        <View
          pointerEvents="none"
          style={[styles.captionSlot, { paddingBottom: TV_GUTTER + lift }]}
        >
          <CaptionText baseSize={TV_CAPTION_BASE} caption={caption} look={captionStyle} />
        </View>
      )}
    </View>
  )
}

const PLAYER_VIEWS = {
  [SURFACE_STATES.waiting]: PlayerNotice,
  [SURFACE_STATES.ready]: DpadPlayer,
} as const satisfies Record<SurfaceState, ComponentType<PlayerChromeProps>>

/** The TV's notice while there is nothing to play, then raven's controls over the video. */
const PlayerChrome = (props: PlayerChromeProps) => {
  const PlayerView = PLAYER_VIEWS[surfaceStateOf(props.surface)]
  return <PlayerView {...props} />
}

/**
 * Android TV's player: raven's controls, which the d-pad drives. ExoPlayer draws the subtitles
 * itself, text and picture alike, on its own clock, as Plex's player does, so a busy app never
 * holds a line back.
 */
export const dpadPlayerChrome: PlayerChromeKit = {
  PlayerChrome,
  shouldDrawCaptions: false,
  canDrawPictureSubtitles: true,
}

/**
 * Apple TV's player: the same controls, which the Siri Remote drives through the same events,
 * with raven's subtitles. AVPlayer draws no picture subtitles, so those are burned in by the
 * server there.
 */
export const tvosPlayerChrome: PlayerChromeKit = {
  PlayerChrome,
  shouldDrawCaptions: true,
  canDrawPictureSubtitles: false,
}
