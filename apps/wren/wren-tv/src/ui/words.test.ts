import { describe, expect, it } from 'bun:test'

import { shownWords } from '@/ui/words'

describe('shownWords', () => {
  it('shows words that say something', () => {
    expect(shownWords('3 songs')).toBe('3 songs')
  })

  it('leaves out words that say nothing', () => {
    expect(shownWords('')).toBeNull()
  })
})
