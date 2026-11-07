import { type PlaybackMode, formatDuration } from '@raven/core'
import type { ComponentProps, ReactNode } from 'react'
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native'
import type Video from 'react-native-video'

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

/** The playing video's heart: whether it is a favourite, and how to mark or unmark it. */
type PlayerFavourite = { isOn: boolean; onToggle: () => void }

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
  /** Null while there is nothing to drive: as the source is asked for, or once nothing plays. */
  transport: Transport | null
  audio: TrackPicker | null
  subtitles: TrackPicker | null
  /** The original or a size to convert down to, the web's Quality list; null with only one to offer. */
  quality: TrackPicker | null
  /** The next episode, once the server has named one, or the next video in a shuffle; null for a film or the show's last. */
  next: PlayerNext | null
  /**
   * The video before this one in a shuffle, which the back-to-the-start button plays in place of
   * starting this one again; null where there is none.
   */
  previous: PlayerNext | null
  /** How the video plays, for the corner that says so; null while no way has been picked. */
  mode: PlaybackMode | null
  /** The heart beside an episode's name or under a film's, for a platform that shows it; null while nothing plays. */
  favourite: PlayerFavourite | null
  /** What plays next in words, "Lucky · S01 · E02 · Make 'em Dance", for the corner; null with nothing after. */
  upNext: string | null
  /** Hands the video to Picture in Picture; null where the player cannot. */
  onPictureInPicture: (() => void) | null
  onBack: () => void
}

/**
 * The player's controls, which each platform draws and drives its own way. `shouldDrawCaptions`
 * says whether raven draws the subtitle cues over the video; where it does not, the platform's
 * player draws the HLS rendition the screen picks.
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
  back: (seconds: number) => `Back ${seconds} seconds`,
  forward: (seconds: number) => `Forward ${seconds} seconds`,
  seek: 'Position',
  of: ({ at, length }: PLAYER_COPYOfProps) => `${at} of ${length}`,
  audio: 'Audio',
  subtitles: 'Subtitles',
  quality: 'Quality',
  pictureInPicture: 'Picture in Picture',
  showControls: 'Show the controls',
  hideControls: 'Hide the controls',
  favourite: 'Favourite',
  upNext: 'Up next',
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
