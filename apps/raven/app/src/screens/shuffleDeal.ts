import { type MediaItem, SESSION_KINDS, shuffled } from '@raven/core'

import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

type ShuffleDealProps = { choices: readonly MediaItem[]; roll?: () => number }

type ShuffleDeal = {
  /** Every choice, in the order the shuffle plays them. */
  queue: MediaItem[]
  /** The first of them, played from where it was left in the `queue` session; null with none. */
  target: RouteTarget | null
}

/**
 * A library's Shuffle: `choices` dealt at random into a queue the player walks with Next and
 * back, and the first of them to play.
 */
export const shuffleDeal = ({ choices, roll }: ShuffleDealProps): ShuffleDeal => {
  const queue = shuffled({ items: choices, roll })
  const [first] = queue
  return {
    queue,
    target:
      first === undefined
        ? null
        : {
            kind: ROUTE_TARGETS.play,
            mediaId: first.id,
            at: 0,
            session: { kind: SESSION_KINDS.queue },
          },
  }
}
