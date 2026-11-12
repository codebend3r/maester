import type { SkipStep } from '@raven/core'
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

type CentreLook = {
  icon: IconName
  /** The few words beside the icon, by the seconds a skip went; null for a mark with none. */
  text: ((seconds: number) => string) | null
  /** What the mark is called aloud, by the seconds a skip went. */
  label: (seconds: number) => string
}

/** Each mark's icon, the few words beside it, and what it is called aloud. */
export const CENTRE_MARK_LOOKS = {
  [CENTRE_MARKS.back]: { icon: 'rewind', text: PLAYER_COPY.seconds, label: PLAYER_COPY.back },
  [CENTRE_MARKS.forward]: {
    icon: 'forward',
    text: PLAYER_COPY.seconds,
    label: PLAYER_COPY.forward,
  },
  [CENTRE_MARKS.play]: { icon: 'play', text: null, label: () => PLAYER_COPY.play },
  [CENTRE_MARKS.pause]: { icon: 'pause', text: null, label: () => PLAYER_COPY.paused },
} as const satisfies Record<CentreMark, CentreLook>

/** A press's flash: its mark, and how far it went when it was a skip. */
export type Flash = { mark: CentreMark; seconds: number }

/** The mark for a way along the video: back or forward. */
const markOfWay = (direction: SkipStep['direction']): CentreMark =>
  direction < 0 ? CENTRE_MARKS.back : CENTRE_MARKS.forward

/** What a skip flashes: its way, beside how far the ladder carried it. */
export const flashOfSkip = ({ direction, seconds }: SkipStep): Flash => ({
  mark: markOfWay(direction),
  seconds,
})

/**
 * What a play or pause flashes: play as a paused video starts. A pause flashes nothing, since
 * the pause mark stands for as long as the video is paused.
 */
export const flashOfToggle = (isPaused: boolean): Flash | null =>
  isPaused ? { mark: CENTRE_MARKS.play, seconds: SKIP_SECONDS } : null

/** What stands in the middle, the seconds beside a skip's way, and whether it fades: a flash fades, a pause or a hold stays. */
export type ShownMark = Flash & { isFading: boolean }

type ShownMarkOfProps = {
  isPaused: boolean
  /** Which way a held key carries the playhead; null while none is held. */
  held: HeldSeek['direction'] | null
  /** The last press's flash; null before any. */
  flash: Flash | null
}

/**
 * What stands in the middle now: the pause mark for as long as the video is paused, a hold's
 * way (beside its first step's seconds) for as long as the key is held, else the last press's
 * flash, which fades.
 */
export const shownMarkOf = ({ isPaused, held, flash }: ShownMarkOfProps): ShownMark | null => {
  if (isPaused) return { mark: CENTRE_MARKS.pause, seconds: SKIP_SECONDS, isFading: false }
  if (held !== null) return { mark: markOfWay(held), seconds: SKIP_SECONDS, isFading: false }
  return flash === null ? null : { ...flash, isFading: true }
}
