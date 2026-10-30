import { describe, expect, it } from 'bun:test'
import { shuffleChoices, shuffled } from '@/shuffle'
import { mediaItem, showEntry } from '@/test/fixtures'

describe('shuffled', () => {
  it('keeps every item, in the order the die deals them', () => {
    expect(shuffled({ items: [1, 2, 3], roll: () => 0 })).toEqual([3, 2, 1])
  })
})

describe('shuffleChoices', () => {
  it("deals each show's next episode, then every file", () => {
    const next = mediaItem({ id: 1 })
    const file = mediaItem({ id: 2 })
    const choices = shuffleChoices({
      shows: [showEntry({ next }), showEntry({ next: null })],
      files: [file],
    })
    expect(choices.map(({ id }) => id)).toEqual([1, 2])
  })
})
