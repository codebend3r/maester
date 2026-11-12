import { describe, expect, it } from 'vitest'
import { letterFolderOf, letterOf } from '@/requests/letterFolders'

describe('letter folders', () => {
  it('files a title under its first letter without a leading article', () => {
    expect(letterOf('The Bear')).toBe('B')
    expect(letterOf('A Beautiful Mind')).toBe('B')
    expect(letterOf('An Ordinary Man')).toBe('O')
    expect(letterOf('sinners')).toBe('S')
  })

  it('files a title that opens with a digit or a mark under #', () => {
    expect(letterOf('10 Cloverfield Lane')).toBe('#')
    expect(letterOf('The 13th Warrior')).toBe('#')
    expect(letterOf('(500) Days of Summer')).toBe('#')
    expect(letterOf('')).toBe('#')
  })

  it('folds accents, and skips quotes before the first letter', () => {
    expect(letterOf('Émilie')).toBe('E')
    expect(letterOf('“Wuthering Heights”')).toBe('W')
    expect(letterOf('Ōoku')).toBe('O')
  })

  it('names the letter folder under the base', () => {
    expect(letterFolderOf({ base: '/Vermithor/TV', title: 'The Bear' })).toBe('/Vermithor/TV/B')
  })
})
