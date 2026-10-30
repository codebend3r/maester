import type { IconName } from '@raven/ui/iconDrawings'

import { PLAYER_COPY, SKIP_SECONDS } from '@/layouts/playerKit'
import type { HeldSeek } from '@/layouts/remoteKeys'

/** What the middle of the picture says just happened: a skip either way, a play, a pause. */
export const CENTRE_MARKS = {
  back: 'back',
  forward: 'forward',
  play: 'play',
  pause: 'pause',
} as const

export type CentreMark = (typeof CENTRE_MARKS)[keyof typeof CENTRE_MARKS]

/** Each mark's icon, the few words beside it, and what it is called aloud. */
export const CENTRE_MARK_LOOKS = {
  [CENTRE_MARKS.back]: {
    icon: 'rewind',
    text: `${SKIP_SECONDS}s`,
    label: PLAYER_COPY.back(SKIP_SECONDS),
  },
  [CENTRE_MARKS.forward]: {
    icon: 'forward',
    text: `${SKIP_SECONDS}s`,
    label: PLAYER_COPY.forward(SKIP_SECONDS),
  },
  [CENTRE_MARKS.play]: { icon: 'play', text: null, label: PLAYER_COPY.play },
  [CENTRE_MARKS.pause]: { icon: 'pause', text: null, label: PLAYER_COPY.paused },
} as const satisfies Record<CentreMark, { icon: IconName; text: string | null; label: string }>

type MarkOfPressProps = { seekBy: number; shouldTogglePlay: boolean; isPaused: boolean }

/**
 * What a press flashes in the middle: a skip's way, or play as a paused video starts. A pause
 * flashes nothing, since the pause mark stands for as long as the video is paused.
 */
export const markOfPress = ({
  seekBy,
  shouldTogglePlay,
  isPaused,
}: MarkOfPressProps): CentreMark | null => {
  if (seekBy < 0) return CENTRE_MARKS.back
  if (seekBy > 0) return CENTRE_MARKS.forward
  return shouldTogglePlay && isPaused ? CENTRE_MARKS.play : null
}

/** What stands in the middle and whether it fades: a flash fades, a pause or a hold stays. */
export type ShownMark = { mark: CentreMark; isFading: boolean }

type ShownMarkOfProps = {
  isPaused: boolean
  /** Which way a held key carries the playhead; null while none is held. */
  held: HeldSeek['direction'] | null
  /** The last press's flash; null before any. */
  flash: CentreMark | null
}

/**
 * What stands in the middle now: the pause mark for as long as the video is paused, a hold's
 * way for as long as the key is held, else the last press's flash, which fades.
 */
export const shownMarkOf = ({ isPaused, held, flash }: ShownMarkOfProps): ShownMark | null => {
  if (isPaused) return { mark: CENTRE_MARKS.pause, isFading: false }
  if (held !== null) {
    return { mark: held < 0 ? CENTRE_MARKS.back : CENTRE_MARKS.forward, isFading: false }
  }
  return flash === null ? null : { mark: flash, isFading: true }
}
