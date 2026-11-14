import {
  FACT_PART_KINDS,
  type FactPart,
  PLAYBACK_MODES,
  type SkipStep,
  formatDuration,
} from '@raven/core'
import {
  type ComponentRef,
  type ComponentType,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Animated,
  PixelRatio,
  Pressable,
  StyleSheet,
  TVFocusGuideView,
  type TVRemoteEvent,
  useTVEventHandler,
  View,
} from 'react-native'
import Video from 'react-native-video'

import { Icon } from '@raven/native'
import { LoadingMark } from '@/layouts/LoadingMark'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import {
  CENTRE_MARK_LOOKS,
  type Flash,
  type ShownMark,
  flashOfSkip,
  flashOfToggle,
  shownMarkOf,
} from '@/layouts/centreMark'
import { useFocusOnMount } from '@/layouts/focus'
import { FocusBand } from '@/layouts/FocusBand'
import { FocusFactChips } from '@/layouts/FactChips'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import { CaptionText } from '@/layouts/PlayerCaption'
import { PlayerNotice } from '@/layouts/PlayerNotice.focus'
import { ChaptersBand } from '@/layouts/PlayerChapters.dpad'
import { chapterMarksOf } from '@/layouts/chapterMarks'
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
  type Transport,
  type TrackPicker,
  surfaceStateOf,
  playedShareOf,
  scrubberAccessibilityOf,
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
import type { IconName } from '@raven/ui/iconDrawings'
import { PLAYBACK_MODE_NAMES, useClock } from '@raven/ui/headless'
import { LINE_RATIO } from '@/layouts/textHeights'
import { requestTVFocus } from '@/layouts/tvFocus'
import { useControlsLinger } from '@/layouts/useControlsLinger'
import { TV_CAPTION_BASE } from '@/player/captionLook'
import { useHeldSeek } from '@/layouts/useHeldSeek'
import { useMarkFade } from '@/layouts/useMarkFade'
import { useSkipLadder } from '@/layouts/useSkipLadder'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { pictureStyles, useTheme } from '@/theme/useTheme'

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** How large the icon in the middle stands. */
const CENTRE_ICON = TV_SIZES.textXl * 2

/** The thumb on the line, and how much it grows while the remote is on it. */
const THUMB = TV_SIZES.space4
const THUMB_FOCUSED = TV_SIZES.space6

/** How wide the cut in the line is where a chapter begins: a hairline, two points on a 1920 point screen. */
const CHAPTER_NOTCH = tvSize(2)

/** How much the chapter playing lightens the track under it: enough to see, never to compete with the played line. */
const CHAPTER_SPAN_OPACITY = 0.22

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
  /** The file's chapters, notched along the line, the one playing a shade lighter than the rest. */
  chapters: PlayerChromeProps['chapters']
  onScrubbing: (isScrubbing: boolean) => void
}

/**
 * Where the video is, as a line the remote stands on: while it has the focus, left and right
 * skip ten seconds (the chrome hears them) and a press plays or pauses. It asks for the focus as
 * it appears and lets go once it has had it; on the player's first appearance the screen is
 * still sliding in, when only the preferred focus, set with the view, takes. TalkBack reads it as
 * the time of the length and skips by its own gesture.
 */
const Scrubber = ({ view, transport, chapters, onScrubbing }: ScrubberProps) => {
  const [isOpening, setOpening] = useState(true)
  const { position, onSeek, onTogglePlay } = transport
  const styles = useStyles()
  const duration = transport.duration ?? 0
  const share = playedShareOf({ at: position, duration })
  const marks = chapterMarksOf({ chapters, duration, at: position })
  return (
    /*
     * Left and right are the scrubber's own: they seek, and a hold runs the playhead. Without the
     * trap the system moves the focus on the key going down, before the press reaches the player,
     * and left carried it off to Back, up and to the left, so it never skipped back.
     */
    <TVFocusGuideView trapFocusLeft trapFocusRight>
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
              {marks.current !== null && <View style={[styles.chapterSpan, marks.current]} />}
              <View style={[styles.played, { width: share }]} />
              {marks.notches.map((notch) => (
                <View key={notch.key} style={[styles.chapterNotch, { left: notch.left }]} />
              ))}
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
    </TVFocusGuideView>
  )
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

type TrackButtonProps = {
  icon: IconName
  label: string
  picker: TrackPicker
  onPicking: (isPicking: boolean) => void
}

/** A track picker as an icon on the player's glass, said with its choice, opening its list over the video. */
const TrackButton = ({ icon, label, picker, onPicking }: TrackButtonProps) => {
  const {
    open,
    label: said,
    list,
  } = usePickerList({
    ...picker,
    label,
    isOverPicture: true,
    onOpenChange: onPicking,
  })
  return (
    <>
      <PlateButton icon={icon} isOverPicture label={said} onPress={open} />
      <PickerList {...list} />
    </>
  )
}

/** How tall a show's title art stands over the video; its width follows the art's own shape. */
const LOGO_HEIGHT = TV_SIZES.space8 * 1.2

/** How much smaller than the page's type the episode's name and its line of facts stand. */
const HEADING_TYPE_SCALE = 0.6

/** How large the time of day stands in the corner: larger than any line of the page's type. */
const CLOCK_SIZE = TV_SIZES.textXl * 1.5

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

type CornerProps = Pick<PlayerChromeProps, 'mode' | 'heading'>

type PictureChipsOfProps = Pick<CornerProps, 'mode' | 'heading'>

/** The picture's chips: its size, then, while it reaches the screen as the file has it, its codec and range. */
const pictureChipsOf = ({ mode, heading }: PictureChipsOfProps): FactPart[] =>
  [
    { kind: FACT_PART_KINDS.resolution, text: heading.quality },
    ...(mode === PLAYBACK_MODES.transcode
      ? []
      : [
          { kind: FACT_PART_KINDS.codec, text: heading.codec },
          { kind: FACT_PART_KINDS.range, text: heading.range },
        ]),
  ].flatMap(({ kind, text }) => (text === null ? [] : [{ kind, text }]))

/**
 * The top right corner, one thing under another: the time of day, the picture's chips, then how
 * the video plays on a line of its own, read out together.
 */
const Corner = ({ mode, heading }: CornerProps) => {
  const styles = useStyles()
  const clock = useClock()
  const way = mode === null ? null : PLAYBACK_MODE_NAMES[mode]
  const chips = pictureChipsOf({ mode, heading })
  return (
    <View
      accessibilityLabel={[clock, ...chips.map(({ text }) => text), way]
        .filter((part): part is string => part !== null)
        .join(', ')}
      accessible
      style={styles.corner}
    >
      <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.clock}>
        {clock}
      </Text>
      {chips.length > 0 && (
        <View style={styles.cornerChips}>
          <FocusFactChips parts={chips} />
        </View>
      )}
      {way !== null && (
        <View style={styles.chip}>
          <Text style={styles.chipText}>{way}</Text>
        </View>
      )}
    </View>
  )
}

type CentreProps = ShownMark

/**
 * What just happened, in the middle of the picture: a skip's way and how far it went, a play, or
 * the pause, on the player's glass. A flash stands for a moment and fades, or goes at once when
 * the system asks for less motion; a pause or a hold stays until it ends. Said aloud as it
 * appears.
 */
const Centre = ({ mark, seconds, isFading }: CentreProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  const { opacity, isGone } = useMarkFade({ isFading })
  const look = CENTRE_MARK_LOOKS[mark]
  return (
    !isGone && (
      <View pointerEvents="none" style={styles.centreSlot}>
        <Animated.View
          accessibilityLabel={look.label(seconds)}
          accessibilityLiveRegion="polite"
          accessible
          style={[styles.centre, { opacity }]}
        >
          <Icon colour={colour} name={look.icon} size={CENTRE_ICON} />
          {look.text !== null && <Text style={styles.centreText}>{look.text(seconds)}</Text>}
        </Animated.View>
      </View>
    )
  )
}

type HeadingLinesProps = Pick<PlayerChromeProps, 'heading'>

/**
 * The title along the top as lines, as the web player's: the show's art (or a film's) on a row
 * of its own, an episode's own name, then the line of what it is (its season and number, its
 * length and its year). A title is marked a favourite on its own page, never here.
 */
const Heading = ({ heading }: HeadingLinesProps) => {
  const styles = useStyles()
  const details = [heading.place, heading.length, heading.year]
    .filter((part): part is string => part !== null)
    .join(PLAYER_COPY.separator)
  // A film's art is its own name; an episode's is its show's, with its own name under it.
  const episodeName = heading.show === null ? null : heading.title
  return (
    <View style={styles.heading}>
      <View accessibilityRole="header">
        <TitleArt
          height={LOGO_HEIGHT}
          logo={heading.logo}
          maxWidth={TV_SIZES.measure}
          name={heading.show ?? heading.title}
          textStyle={styles.show}
        />
      </View>
      {episodeName !== null && (
        <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.title}>
          {episodeName}
        </Text>
      )}
      {details !== '' && <Text style={styles.details}>{details}</Text>}
    </View>
  )
}

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
  const styles = useStyles()
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
            <PlateButton icon="back" isOverPicture label={PLAYER_COPY.leave} onPress={onBack} />
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
                    icon="skipPrevious"
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
                    icon={transport.isPaused ? 'play' : 'pause'}
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
                  icon="skipNext"
                  isOverPicture
                  label={next.label}
                  onPress={next.onPlay}
                />
              )}
            </View>
            <View style={styles.buttonGroup}>
              {audio !== null && (
                <TrackButton
                  icon="volume"
                  label={PLAYER_COPY.audio}
                  onPicking={onPicking}
                  picker={audio}
                />
              )}
              {subtitles !== null && (
                <TrackButton
                  icon="captions"
                  label={PLAYER_COPY.subtitles}
                  onPicking={onPicking}
                  picker={subtitles}
                />
              )}
              {quality !== null && (
                <TrackButton
                  icon="settings"
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
  const styles = useStyles()
  const isPlaying = transport !== null && !transport.isPaused
  // The last press's flash, counted so the same one twice starts afresh.
  const [flash, setFlash] = useState<(Flash & { count: number }) | null>(null)
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
          <LoadingMark
            gap={TV_SIZES.space5}
            isOverPicture
            label={PLAYER_COPY.opening}
            markWidth={TV_SIZES.space8 * 2}
          />
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

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colours.ground },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colours.ground,
      opacity: SCRIM_OPACITY,
    },
    frame: { flex: 1, justifyContent: 'space-between', padding: TV_GUTTER },
    top: { flexDirection: 'row', justifyContent: 'space-between', gap: TV_SIZES.space4 },
    topStart: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flexShrink: 1,
      gap: TV_SIZES.space4,
    },
    heading: { gap: TV_SIZES.space2, maxWidth: TV_SIZES.measure },
    /*
     * Never squeezed by the heading beside it, which shrinks instead, and as wide as the clock
     * needs: the time is always whole on one line.
     */
    corner: { flexShrink: 0, alignItems: 'flex-end', gap: TV_SIZES.space2 },
    cornerChips: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space1 },
    clock: {
      flexShrink: 0,
      color: colours.text,
      fontSize: CLOCK_SIZE,
      lineHeight: CLOCK_SIZE * LINE_RATIO,
      fontVariant: ['tabular-nums'],
    },
    show: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    // Its season and number, its length and its year.
    details: {
      color: colours.muted,
      fontSize: TV_SIZES.textLg * HEADING_TYPE_SCALE,
      fontVariant: ['tabular-nums'],
    },
    title: {
      flexShrink: 1,
      color: colours.text,
      fontSize: TV_SIZES.textXl * HEADING_TYPE_SCALE,
    },
    chip: {
      paddingHorizontal: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space0,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.quiet,
    },
    chipText: { color: colours.text, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    bottom: { gap: TV_SIZES.space3 },
    timeline: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
    time: { color: colours.text, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    /*
     * Room at each end for the focused thumb, which is centred on the line's end and would
     * otherwise sit over the time beside it.
     */
    scrubberSlot: { flex: 1, paddingHorizontal: THUMB_FOCUSED / 2 },
    scrubber: { height: TV_SIZES.controlLarge, justifyContent: 'center' },
    line: {
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
    },
    lineFocused: { height: TV_SIZES.space2 },
    played: { height: '100%', backgroundColor: colours.played },
    // The chapter playing, a shade over the track, so its length reads at a glance.
    chapterSpan: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: colours.text,
      opacity: CHAPTER_SPAN_OPACITY,
    },
    // A slim cut in the line where a chapter begins, in the stage's dark.
    chapterNotch: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: CHAPTER_NOTCH,
      marginLeft: -CHAPTER_NOTCH / 2,
      backgroundColor: colours.ground,
    },
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
    // The transport at the left, the track pickers at the right.
    buttons: { flexDirection: 'row', justifyContent: 'space-between', gap: TV_SIZES.space3 },
    buttonGroup: { flexDirection: 'row', gap: TV_SIZES.space3 },
    captionSlot: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: TV_GUTTER,
    },
    noticeSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    centreSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    centre: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space4,
      paddingHorizontal: TV_SIZES.space5,
      borderRadius: TV_SIZES.radius * 3,
      backgroundColor: colours.raised,
    },
    centreText: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      fontWeight: 'bold',
      fontVariant: ['tabular-nums'],
    },
    notice: {
      maxWidth: TV_SIZES.measure,
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      textAlign: 'center',
    },
  }),
)
