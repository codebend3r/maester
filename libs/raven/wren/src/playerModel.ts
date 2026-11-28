import { type QueueSource, REPEAT_MODES, type RepeatMode, formatDuration } from '@raven/core'

import { PLAYER_COPY } from '@/copy/kit'
import { sourceIdOf } from '@/nowPlaying/nowPlayingModel'

/**
 * How far one step of the scrubber moves the playhead, in seconds: a screen reader's swipe, an
 * arrow key or a remote's press.
 */
export const SCRUB_STEP_SECONDS = 15

type ProgressOfProps = { position: number; length: number }

/** How far through the track it is, from 0 to 1, and none while its length is unknown. */
export const progressOf = ({ position, length }: ProgressOfProps): number =>
  length > 0 ? Math.min(1, position / length) : 0

/** Where the scrubber stands, read out: "1:02 of 4:44". */
export const scrubTextOf = ({ position, length }: ProgressOfProps): string =>
  PLAYER_COPY.scrubText({ at: formatDuration(position), length: formatDuration(length) })

/**
 * Where the transport, Previous, Play or Pause and Next, is drawn: the player's, the lyrics', Up
 * next's and the player bar's. Shuffle and Repeat are the queue's, in Up next's head.
 */
export const TRANSPORTS = {
  player: 'player',
  lyrics: 'lyrics',
  queue: 'queue',
  bar: 'bar',
} as const

export type TransportKind = (typeof TRANSPORTS)[keyof typeof TRANSPORTS]

/** The transport's two steps through the queue, each named as the queue's own action is. */
export const STEPS = { previous: 'previous', next: 'next' } as const

export type Step = (typeof STEPS)[keyof typeof STEPS]

/** A queue toggle's ink and ground, by the name each app's palette holds the colour under. */
const TOGGLE_LOOKS = {
  on: { color: 'accentText', fill: 'accentSoft' },
  off: { color: 'text3', fill: 'surface2' },
} as const

type ToggleLookKeys = (typeof TOGGLE_LOOKS)[keyof typeof TOGGLE_LOOKS]

/** A queue toggle's ink and ground. `Color` is each app's own colour. */
type ToggleLook<Color> = { color: Color; fill: Color }

type ToggleLookOfProps<Color> = {
  isOn: boolean
  /** The app's palette, which holds the toggles' colours under these names. */
  colors: Record<ToggleLookKeys[keyof ToggleLookKeys], Color>
}

/** Shuffle's and Repeat's ink and ground: red on a soft red circle while on, quiet while off. */
export const toggleLookOf = <Color>({
  isOn,
  colors,
}: ToggleLookOfProps<Color>): ToggleLook<Color> => {
  const { color, fill } = isOn ? TOGGLE_LOOKS.on : TOGGLE_LOOKS.off
  return { color: colors[color], fill: colors[fill] }
}

/** The drawings Repeat wears, which each app's `ICONS` holds under these names. */
type RepeatIcons<Icon> = { repeat: Icon; repeatOne: Icon }

type RepeatIconOfProps<Icon> = { repeat: RepeatMode; icons: RepeatIcons<Icon> }

/** The drawing for a repeat mode, so repeating one song never looks like repeating them all. */
export const repeatIconOf = <Icon>({ repeat, icons }: RepeatIconOfProps<Icon>): Icon =>
  repeat === REPEAT_MODES.one ? icons.repeatOne : icons.repeat

/**
 * What a page's Play does: start the page's songs from the top, or, while the queue already plays
 * from this page, pause it, or carry on once it is paused.
 */
export const PAGE_PLAYS = { start: 'start', pause: 'pause', resume: 'resume' } as const

export type PagePlay = (typeof PAGE_PLAYS)[keyof typeof PAGE_PLAYS]

type PagePlayOfProps = {
  /** Where the page's songs come from; none for a list of songs, whose Play always starts. */
  source: QueueSource | undefined
  /** Where the queue plays from, if anywhere. */
  queued: QueueSource | null | undefined
  isPlaying: boolean
}

/** What a page's Play does now, by whether the queue plays from that page and is playing. */
export const pagePlayOf = ({ source, queued, isPlaying }: PagePlayOfProps): PagePlay => {
  const isFromPage =
    source !== undefined && sourceIdOf({ source: queued ?? null, kind: source.kind }) === source.id
  if (!isFromPage) return PAGE_PLAYS.start
  return isPlaying ? PAGE_PLAYS.pause : PAGE_PLAYS.resume
}
