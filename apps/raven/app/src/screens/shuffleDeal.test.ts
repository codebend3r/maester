import { SESSION_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'

import { ROUTE_TARGETS } from '@/routes'
import { shuffleDeal } from '@/screens/shuffleDeal'
import { queueNeighbourOf } from '@/stores/videoQueue'
import { mediaItemFor } from '@/test/mediaItem'

describe('shuffleDeal', () => {
  it('deals every choice into the queue and plays the first in the queue session', () => {
    const choices = [mediaItemFor({ id: 1 }), mediaItemFor({ id: 2 }), mediaItemFor({ id: 3 })]
    const deal = shuffleDeal({ choices, roll: () => 0 })
    expect(deal.queue.map(({ id }) => id).toSorted()).toEqual([1, 2, 3])
    expect(deal.target).toEqual({
      kind: ROUTE_TARGETS.play,
      mediaId: deal.queue[0]?.id,
      at: 0,
      session: { kind: SESSION_KINDS.queue },
    })
  })

  it('goes nowhere with nothing to deal', () => {
    expect(shuffleDeal({ choices: [] })).toEqual({ queue: [], target: null })
  })
})

describe('queueNeighbourOf', () => {
  const items = [mediaItemFor({ id: 7 }), mediaItemFor({ id: 8 }), mediaItemFor({ id: 9 })]

  it('finds the video after and before the one playing', () => {
    expect(queueNeighbourOf({ items, mediaId: 8, step: 1 })?.id).toBe(9)
    expect(queueNeighbourOf({ items, mediaId: 8, step: -1 })?.id).toBe(7)
  })

  it('has none past either end, or for a video off the queue', () => {
    expect(queueNeighbourOf({ items, mediaId: 9, step: 1 })).toBeNull()
    expect(queueNeighbourOf({ items, mediaId: 7, step: -1 })).toBeNull()
    expect(queueNeighbourOf({ items, mediaId: 4, step: 1 })).toBeNull()
  })
})
