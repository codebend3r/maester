import { describe, expect, it } from 'vitest'
import { letterFolderOf } from '@/requests/letterFolders'

const BASE = '/Meleys/Movies'

const folderOf = (title: string): string => letterFolderOf({ base: BASE, title })

describe('letter folders', () => {
  it('files a title under its first letter without a leading article', () => {
    expect(folderOf('The Bear')).toBe(`${BASE}/B`)
    expect(folderOf('A Beautiful Mind')).toBe(`${BASE}/B`)
    expect(folderOf('An Ordinary Man')).toBe(`${BASE}/O`)
    expect(folderOf('sinners')).toBe(`${BASE}/S`)
  })

  it('files a title that opens with a digit or a mark under #', () => {
    expect(folderOf('10 Cloverfield Lane')).toBe(`${BASE}/#`)
    expect(folderOf('The 13th Warrior')).toBe(`${BASE}/#`)
    expect(folderOf('(500) Days of Summer')).toBe(`${BASE}/#`)
    expect(folderOf('')).toBe(`${BASE}/#`)
  })

  it('folds accents, and skips quotes before the first letter', () => {
    expect(folderOf('Émilie')).toBe(`${BASE}/E`)
    expect(folderOf('“Wuthering Heights”')).toBe(`${BASE}/W`)
    expect(folderOf('Ōoku')).toBe(`${BASE}/O`)
  })

  it('names the letter folder under the base', () => {
    expect(letterFolderOf({ base: '/Vermithor/TV', title: 'The Bear' })).toBe('/Vermithor/TV/B')
  })
})
