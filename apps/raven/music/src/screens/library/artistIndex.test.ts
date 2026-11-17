import { describe, expect, it } from 'bun:test'

import { INDEX_LETTERS, firstAtLetter, letterOf } from '@/screens/library/artistIndex'

const NAMES = ['03 Greedo', '2 Chainz', 'Ábba', 'Beck', 'Radiohead', 'Zola']

describe('letterOf', () => {
  it('files a name under its first letter, accents dropped, and the rest under #', () => {
    expect(letterOf('radiohead')).toBe('R')
    expect(letterOf('Ábba')).toBe('A')
    expect(letterOf('03 Greedo')).toBe('#')
    expect(letterOf('$uicideboy$')).toBe('#')
  })
})

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

  it('offers # and the alphabet', () => {
    expect(INDEX_LETTERS).toHaveLength(27)
    expect(INDEX_LETTERS[0]).toBe('#')
    expect(INDEX_LETTERS.at(-1)).toBe('Z')
  })
})
