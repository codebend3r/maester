import { type MediaItem, shuffled } from '@raven/core'

import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

type ShuffleTargetProps = { choices: readonly MediaItem[]; roll?: () => number }

/**
 * Where a library's Shuffle goes: one of `choices` dealt at random, played from where it was
 * left, as a card's Play is; null when there is nothing to deal. The player plays one video at
 * a time, and a show's Next carries on from an episode, so one pick is the whole shuffle.
 */
export const shuffleTarget = ({ choices, roll }: ShuffleTargetProps): RouteTarget | null => {
  const picked = shuffled({ items: choices, roll }).at(0)
  return picked === undefined ? null : { kind: ROUTE_TARGETS.play, mediaId: picked.id, at: 0 }
}
