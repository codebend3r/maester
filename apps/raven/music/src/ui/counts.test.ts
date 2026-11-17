import { describe, expect, it } from 'bun:test'

import { countsLineOf, factsLineOf } from '@/ui/counts'

describe('countsLineOf', () => {
  it('puts the albums before the tracks', () => {
    expect(countsLineOf({ albums: 7, tracks: 114 })).toBe('7 albums · 114 tracks')
  })

  it('drops a zero count rather than printing it', () => {
    expect(countsLineOf({ albums: 0, tracks: 1 })).toBe('1 track')
  })

  it('says one in the singular', () => {
    expect(countsLineOf({ albums: 1, tracks: 0 })).toBe('1 album')
  })

  it('is empty when everything is zero', () => {
    expect(countsLineOf({ albums: 0, tracks: 0 })).toBe('')
  })

  it('counts songs on their own', () => {
    expect(countsLineOf({ songs: 4812 })).toBe('4,812 songs')
  })
})

describe('factsLineOf', () => {
  it('joins the facts with a dot, leaving out the missing and the empty', () => {
    expect(factsLineOf(['Pop', null, '2014', ''])).toBe('Pop · 2014')
  })

  it('is empty with no facts', () => {
    expect(factsLineOf([null])).toBe('')
  })
})
