import { PLAYBACK_MODES, type PlaybackMode, formatDuration } from '@raven/core'
import type { ComponentProps, ReactNode } from 'react'
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native'
import type Video from 'react-native-video'

import type { PickerProps } from '@/layouts/gridKit'
import type { PlayerHeading } from '@/layouts/playerHeading'

/** How far a skip button moves, in seconds, as the web's Back 10 and Forward 10 do. */
export const SKIP_SECONDS = 10

/** What plays after the video, an episode's next in its show, and how to play it now. */
type PlayerNext = { label: string; onPlay: () => void }

/** A track picker: what it offers, which is picked, and what to do with a pick; the chrome names it. */
export type TrackPicker = Omit<PickerProps<string>, 'label'>

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
  /** A line in place of the video: while it opens, when it is refused, when nothing plays. */
  notice: string | null
  /** The subtitle cues showing now, as WebVTT text, drawn over the video whether or not the controls are. */
  caption: string | null
  /** Null while there is nothing to drive: as the source is asked for, or once nothing plays. */
  transport: Transport | null
  audio: TrackPicker | null
  subtitles: TrackPicker | null
  /** The next episode, once the server has named one; null for a film or the show's last. */
  next: PlayerNext | null
  /** How the video plays, for the corner that says so; null while no way has been picked. */
  mode: PlaybackMode | null
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
}

type PLAYER_COPYOfProps = { at: string; length: string }

export const PLAYER_COPY = {
  play: 'Play',
  leave: 'Back',
  pause: 'Pause',
  next: 'Next episode',
  /** How each way of playing reads in the corner. */
  modes: {
    [PLAYBACK_MODES.direct]: 'Direct play',
    [PLAYBACK_MODES.remux]: 'Remux',
    [PLAYBACK_MODES.transcode]: 'Transcode',
  } satisfies Record<PlaybackMode, string>,
  back: (seconds: number) => `Back ${seconds} seconds`,
  forward: (seconds: number) => `Forward ${seconds} seconds`,
  seek: 'Position',
  of: ({ at, length }: PLAYER_COPYOfProps) => `${at} of ${length}`,
  audio: 'Audio',
  subtitles: 'Subtitles',
  pictureInPicture: 'Picture in Picture',
  showControls: 'Show the controls',
  hideControls: 'Hide the controls',
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
