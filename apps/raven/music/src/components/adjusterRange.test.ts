import { describe, expect, it } from 'bun:test'

import { adjusterRangeOf } from '@/components/adjusterRange'

describe('adjusterRangeOf', () => {
  it('reads a range set in fractions, the volume, in hundredths', () => {
    expect(adjusterRangeOf({ value: 0.8, max: 1, step: 0.1 })).toEqual({
      min: 0,
      max: 100,
      now: 80,
    })
  })

  it('reads a range set in whole steps, the scrubber, as it is', () => {
    expect(adjusterRangeOf({ value: 62.4, max: 284, step: 15 })).toEqual({
      min: 0,
      max: 284,
      now: 62,
    })
  })
})
