import type { ReactNode } from 'react'

import type { HeroSlide } from '@/queries/heroSlides'
import type { RouteTarget } from '@/routes'

/** How long each title holds before the next takes its place, as the web's hero. */
export const HERO_MS = 7000

type CounterProps = { at: number; count: number }

/** The hero's words, and what its controls are called aloud. */
export const HERO_COPY = {
  featured: 'Featured',
  play: 'Play',
  details: 'Details',
  previous: 'Previous',
  next: 'Next',
  separator: '  ·  ',
  playTitle: (title: string) => `Play ${title}`,
  detailsOf: (title: string) => `Details for ${title}`,
  counter: ({ at, count }: CounterProps) => `${at} / ${count}`,
} as const

/** A poster's place in the fan: on top, tilted out to either side, or tucked away behind. */
export const FAN_PLACES = {
  front: 'front',
  next: 'next',
  previous: 'previous',
  away: 'away',
} as const

export type FanPlace = (typeof FAN_PLACES)[keyof typeof FAN_PLACES]

type FanOffsetProps = { index: number; at: number; count: number }

/** How many turns after the one up a slide comes: 0 for the one up, `count - 1` for the last. */
export const fanOffsetOf = ({ index, at, count }: FanOffsetProps): number =>
  (index - at + count) % count

type FanPlaceOfProps = { offset: number; count: number }

export const fanPlaceOf = ({ offset, count }: FanPlaceOfProps): FanPlace => {
  if (offset === 0) return FAN_PLACES.front
  if (offset === 1) return FAN_PLACES.next
  return offset === count - 1 ? FAN_PLACES.previous : FAN_PLACES.away
}

/** How far past the front a poster is still drawn: the next, and the one after it. */
const FAN_DRAWN = 2

/** Whether the fan draws a poster: the ones in view, and the one the next turn brings in. */
export const isInFan = ({ offset, count }: FanPlaceOfProps): boolean =>
  offset <= FAN_DRAWN || offset === count - 1

/** Which slide is up, and the one it took over from, whose backdrop fades out. */
export type HeroTurn = { at: number; from: number | null }

type StepTurnProps = { turn: HeroTurn; by: number; count: number }

/** The turn `by` slides on from `turn`, round the ends either way. */
export const stepTurn = ({ turn, by, count }: StepTurnProps): HeroTurn => ({
  at: (turn.at + by + count) % count,
  from: turn.at,
})

type IsInWashProps = { index: number; turn: HeroTurn; count: number }

/**
 * Which backdrops the wash draws: the one up, the one it took over from, fading out, and the
 * next, loading unseen so it is there by its turn.
 */
export const isInWash = ({ index, turn, count }: IsInWashProps): boolean =>
  index === turn.at || index === turn.from || index === (turn.at + 1) % count

/** How big a title is set: as the web's, smaller for a long title or a long word. */
export const TITLE_SIZES = { display: 'display', long: 'long', longest: 'longest' } as const

export type TitleSize = (typeof TITLE_SIZES)[keyof typeof TITLE_SIZES]

export const titleSizeOf = (title: string): TitleSize => {
  if (title.length > 36) return TITLE_SIZES.longest
  return title.length > 16 || title.split(' ').some((word) => word.length > 9)
    ? TITLE_SIZES.long
    : TITLE_SIZES.display
}

export type HomeHeroProps = {
  slides: readonly HeroSlide[]
  onOpen: (target: RouteTarget) => void
  /** Whether Play takes the remote's focus as Home opens. */
  isPreferred: boolean
}

/** Home's hero, which each platform draws its own way. */
export type HeroKit = { HomeHero: (props: HomeHeroProps) => ReactNode }
