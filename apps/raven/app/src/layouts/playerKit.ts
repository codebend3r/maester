import {
  type CaptionStyle,
  type Chapter,
  FACT_PART_KINDS,
  type FactPart,
  type Marker,
  PLAYBACK_MODES,
  type PlaybackMode,
  formatDuration,
} from '@raven/core'
import type { ComponentProps, ReactNode } from 'react'
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native'
import type Video from 'react-native-video'

import { PLAYBACK_MODE_NAMES } from '@raven/ui/headless'
import type { IconName } from '@raven/ui/iconDrawings'

import type { PickerProps } from '@/layouts/gridKit'
import type { PlayerHeading } from '@/layouts/playerHeading'

/** How far a skip button moves, in seconds, either way. */
export const SKIP_SECONDS = 10

export const SKIP_DIRECTIONS = { back: 'back', forward: 'forward' } as const

export type SkipDirection = (typeof SKIP_DIRECTIONS)[keyof typeof SKIP_DIRECTIONS]

/** Each skip's icon: a circle open at the top with an arrowhead, the seconds set inside it. */
export const SKIP_ICONS = {
  [SKIP_DIRECTIONS.back]: 'skipBack',
  [SKIP_DIRECTIONS.forward]: 'skipForward',
} as const satisfies Record<SkipDirection, IconName>

/** What plays after the video, an episode's next in its show, and how to play it now. */
type PlayerNext = { label: string; onPlay: () => void }

/** What plays next, with its words for the card that offers it: "Lucky · S01 · E02 · Make 'em Dance". */
type PlayerUpNext = PlayerNext & { words: string }

/** A track picker: what it offers, which is picked, and what to do with a pick; the chrome names it. */
export type TrackPicker = Omit<PickerProps<string>, 'label' | 'icon'>

/** The transport, once there is a video to drive. */
export type Transport = {
  isPaused: boolean
  /** Where the video is, in seconds. */
  position: number
  /** How long it is, in seconds; null until it is known. */
  duration: number | null
  onTogglePlay: () => void
  onSeek: (seconds: number) => void
}

/**
 * The video as the screen drives it: its source, what it is told and what it reports. Each
 * chrome draws it under everything, with what only its platform's player takes.
 */
export type VideoSurface = ComponentProps<typeof Video>

/** Whether the chrome has a video to draw yet, or only the line in its place. */
export const SURFACE_STATES = { waiting: 'waiting', ready: 'ready' } as const

export type SurfaceState = (typeof SURFACE_STATES)[keyof typeof SURFACE_STATES]

export const surfaceStateOf = (surface: VideoSurface | null): SurfaceState =>
  surface === null ? SURFACE_STATES.waiting : SURFACE_STATES.ready

export type PlayerChromeProps = {
  title: string
  /** The title as lines, for a platform that sets it out so: show, season and episode, name, length. */
  heading: PlayerHeading
  /** What the video is about, for a platform that shows it beside the player; null when unknown. */
  summary: string | null
  /** The video's poster, for a platform that shows it beside the player; null when it has none. */
  artwork: string | null
  /** The video, once there is a source to play; null while there is nothing to draw. */
  surface: VideoSurface | null
  /** A line in place of the video: when it is refused, or when nothing plays. */
  notice: string | null
  /** Whether the video is still opening, which the chrome shows as raven's mark and a spinner, never in words. */
  isOpening: boolean
  /** The subtitle cues showing now, as WebVTT text, drawn over the video whether or not the controls are. */
  caption: string | null
  /** How the account's subtitles look: the size and colour raven draws the cues in, where it draws them. */
  captionStyle: CaptionStyle
  /** Null while there is nothing to drive: as the source is asked for, or once nothing plays. */
  transport: Transport | null
  audio: TrackPicker | null
  subtitles: TrackPicker | null
  /** The original or a size to convert down to, the web's Quality list; null with only one to offer. */
  quality: TrackPicker | null
  /** The next episode, once the server has named one, or the next video in a shuffle; null for a film or the show's last. */
  next: PlayerUpNext | null
  /**
   * The video before this one in a shuffle, which the back-to-the-start button plays in place of
   * starting this one again; null where there is none.
   */
  previous: PlayerNext | null
  /** How the video plays, for the corner that says so; null while no way has been picked. */
  mode: PlaybackMode | null
  /** The file's credits, where the countdown to what plays next starts; null while none are known. */
  credits: Marker | null
  /** The file's chapters, in order, for a platform that offers them to jump to; empty while none are known. */
  chapters: readonly Chapter[]
  onBack: () => void
}

/**
 * The player's controls, which each platform draws and drives its own way. `shouldDrawCaptions`
 * says whether raven draws the subtitle cues over the video; where it does not, the platform's
 * player draws the track the screen picks, on its own clock.
 */
export type PlayerChromeKit = {
  PlayerChrome: (props: PlayerChromeProps) => ReactNode
  shouldDrawCaptions: boolean
  /**
   * Whether the platform's player draws a file's picture subtitles (Blu-ray PGS) itself while it
   * plays the file as it is: ExoPlayer does, AVPlayer does not. A stream never carries them.
   */
  canDrawPictureSubtitles: boolean
}

type PLAYER_COPYOfProps = { at: string; length: string }

type PLAYER_COPYChapterProps = { name: string; at: string }

export const PLAYER_COPY = {
  play: 'Play',
  leave: 'Back',
  pause: 'Pause',
  paused: 'Paused',
  /** What the opening mark is called aloud; it is never shown. */
  opening: 'Opening the video',
  next: 'Next episode',
  nextVideo: 'Next',
  previousVideo: 'Previous',
  restart: 'Back to the start',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
  /** What holding the speaker does, as the screen reader hints it. */
  volumeHint: 'Hold to show the volume slider',
  back: (seconds: number) => `Back ${seconds} seconds`,
  forward: (seconds: number) => `Forward ${seconds} seconds`,
  /** How far a skip went, beside its icon: "20s". */
  seconds: (seconds: number) => `${seconds}s`,
  /** The speed a held finger plays at, beside its icon: "2×". */
  rate: (rate: number) => `${rate}×`,
  holdForward: (rate: number) => `Playing at ${rate}× speed`,
  holdBack: (rate: number) => `Rewinding at ${rate}× speed`,
  seek: 'Position',
  of: ({ at, length }: PLAYER_COPYOfProps) => `${at} of ${length}`,
  audio: 'Audio',
  subtitles: 'Subtitles',
  quality: 'Quality',
  showControls: 'Show the controls',
  hideControls: 'Hide the controls',
  upNext: 'Up next',
  playNow: 'Play now',
  watchCredits: 'Watch credits',
  /** How long until what is next plays by itself: "Plays in 1 second", "Plays in 12 seconds". */
  playsIn: (seconds: number) => `Plays in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`,
  sceneAfter: 'A scene follows the credits',
  chapters: 'Chapters',
  /** An untitled chapter by its place: "Chapter 3". */
  chapter: (place: number) => `Chapter ${place}`,
  /** A chapter as read out: "Chapter 3, The Dam, at 12:04". */
  chapterLabel: ({ name, at }: PLAYER_COPYChapterProps) => `${name}, at ${at}`,
  separator: ' · ',
} as const

/** The actions a screen reader offers on the scrubber: a swipe up or down skips. */
const SEEK_ACTIONS = { increment: 'increment', decrement: 'decrement' } as const

const SEEK_ACTION_LIST: AccessibilityActionInfo[] = [
  { name: SEEK_ACTIONS.increment },
  { name: SEEK_ACTIONS.decrement },
]

type WithinProps = { value: number; length: number }

/** `value` kept between the start and `length`. */
export const within = ({ value, length }: WithinProps): number =>
  Math.min(length, Math.max(0, value))

type PlayedShareOfProps = { at: number; duration: number }

/** How far along the line the spot `at` is, as a width or an offset: `'40%'`. */
export const playedShareOf = ({ at, duration }: PlayedShareOfProps): `${number}%` =>
  duration > 0 ? `${(within({ value: at, length: duration }) / duration) * 100}%` : '0%'

type ScrubberAccessibilityOfProps = Pick<Transport, 'position' | 'onSeek'> & {
  shown: number
  duration: number
}

/**
 * What a screen reader makes of a scrubber: the time `shown` of the length, and a skip either
 * way from where the video is, so VoiceOver and TalkBack drive it as the remote and the thumb do.
 */
export const scrubberAccessibilityOf = ({
  position,
  shown,
  duration,
  onSeek,
}: ScrubberAccessibilityOfProps) => ({
  accessible: true,
  accessibilityActions: SEEK_ACTION_LIST,
  accessibilityLabel: PLAYER_COPY.seek,
  accessibilityRole: 'adjustable' as const,
  accessibilityValue: {
    min: 0,
    max: Math.round(duration),
    now: Math.round(shown),
    text: PLAYER_COPY.of({ at: formatDuration(shown), length: formatDuration(duration) }),
  },
  onAccessibilityAction: ({ nativeEvent }: AccessibilityActionEvent) => {
    if (nativeEvent.actionName === SEEK_ACTIONS.increment) onSeek(position + SKIP_SECONDS)
    if (nativeEvent.actionName === SEEK_ACTIONS.decrement) onSeek(position - SKIP_SECONDS)
  },
})

type PictureChipsOfProps = Pick<PlayerChromeProps, 'mode' | 'heading'>

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

type CornerFactsOfProps = PictureChipsOfProps & { clock: string }

/** What a player's top right corner shows, one under another, and the words it is read out in. */
type CornerFacts = { clock: string; chips: FactPart[]; way: string | null; label: string }

/** The top right corner both chromes draw: the time of day, the picture's chips, then how the video plays. */
export const cornerFactsOf = ({ mode, heading, clock }: CornerFactsOfProps): CornerFacts => {
  const chips = pictureChipsOf({ mode, heading })
  const way = mode === null ? null : PLAYBACK_MODE_NAMES[mode]
  const label = [clock, ...chips.map(({ text }) => text), way]
    .filter((part): part is string => part !== null)
    .join(', ')
  return { clock, chips, way, label }
}
