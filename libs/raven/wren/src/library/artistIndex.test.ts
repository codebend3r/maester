import { describe, expect, it } from 'bun:test'

import { firstAtLetter } from '@/library/artistIndex'

const NAMES = ['03 Greedo', '2 Chainz', 'Ábba', 'Beck', 'Radiohead', 'Zola']

describe('firstAtLetter', () => {
  it('jumps to the first name under a letter', () => {
    expect(firstAtLetter({ names: NAMES, letter: '#' })).toBe(0)
    expect(firstAtLetter({ names: NAMES, letter: 'A' })).toBe(2)
    expect(firstAtLetter({ names: NAMES, letter: 'R' })).toBe(4)
  })

  it('jumps to the next letter that has a name, or nowhere past the last', () => {
    expect(firstAtLetter({ names: NAMES, letter: 'C' })).toBe(4)
    expect(firstAtLetter({ names: ['Abba'], letter: 'Z' })).toBeNull()
  })
})
