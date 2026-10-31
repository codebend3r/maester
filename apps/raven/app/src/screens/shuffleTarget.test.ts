import { describe, expect, it } from 'bun:test'

import { ROUTE_TARGETS } from '@/routes'
import { shuffleTarget } from '@/screens/shuffleTarget'
import { mediaItemFor } from '@/test/mediaItem'

describe('shuffleTarget', () => {
  it('plays the video the die deals, from where it was left', () => {
    const choices = [mediaItemFor({ id: 1 }), mediaItemFor({ id: 2 })]
    expect(shuffleTarget({ choices, roll: () => 0 })).toEqual({
      kind: ROUTE_TARGETS.play,
      mediaId: 2,
      at: 0,
    })
  })

  it('goes nowhere with nothing to deal', () => {
    expect(shuffleTarget({ choices: [] })).toBeNull()
  })
})
