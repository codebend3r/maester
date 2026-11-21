import { describe, expect, it } from 'bun:test'

import { factsLineOf } from '@/copy/kit'
import { countValueOf, countsLineOf, lineValueOf } from '@/counts'

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

describe('lineValueOf', () => {
  it('reads what it holds, what none reads as, or nothing while it is not known', () => {
    expect(lineValueOf({ line: '2 playlists', none: 'Create your first' })).toBe('2 playlists')
    expect(lineValueOf({ line: '', none: 'Create your first' })).toBe('Create your first')
    expect(lineValueOf({ line: null, none: 'Create your first' })).toBeUndefined()
  })
})

describe('countValueOf', () => {
  it('reads a count, none where that says something, or nothing at all', () => {
    expect(countValueOf({ n: 1980 })).toBe(new Intl.NumberFormat().format(1980))
    expect(countValueOf({ n: 7 })).toBe('7')
    expect(countValueOf({ n: 0, none: 'None yet' })).toBe('None yet')
    expect(countValueOf({ n: 0 })).toBeUndefined()
    expect(countValueOf({ n: null, none: 'None yet' })).toBeUndefined()
  })
})
