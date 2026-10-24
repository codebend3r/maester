import type { ComponentProps, ReactNode } from 'react'
import type Video from 'react-native-video'

import type { PickerProps } from '@/layouts/gridKit'

/** How far a skip button moves, in seconds, as the web's Back 10 and Forward 10 do. */
export const SKIP_SECONDS = 10

/** A track picker: what it offers, which is picked, and what to do with a pick; the chrome names it. */
type TrackPicker = Omit<PickerProps<string>, 'label'>

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

export const PLAYER_COPY = {
  play: 'Play',
  pause: 'Pause',
  back: (seconds: number) => `Back ${seconds} seconds`,
  forward: (seconds: number) => `Forward ${seconds} seconds`,
  seek: 'Position',
  of: ({ at, length }: { at: string; length: string }) => `${at} of ${length}`,
  audio: 'Audio',
  subtitles: 'Subtitles',
  pictureInPicture: 'Picture in Picture',
  showControls: 'Show the controls',
  hideControls: 'Hide the controls',
} as const
