import { describe, expect, it } from 'bun:test'
import { confidenceTierOf, isConfidenceTier } from '@/matchConfidence'

describe('confidence tiers', () => {
  it('reads Strong from 80, Possible from 50 and Weak below', () => {
    expect([0, 49, 50, 79, 80, 100].map(confidenceTierOf)).toEqual([
      'weak',
      'weak',
      'possible',
      'possible',
      'strong',
      'strong',
    ])
  })

  it('knows its tiers', () => {
    expect(isConfidenceTier.values).toEqual(['strong', 'possible', 'weak'])
    expect(isConfidenceTier('sure')).toBe(false)
  })
})
