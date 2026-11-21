import { describe, expect, it } from 'bun:test'

import { KIT_COPY } from '@/copy/kit'
import { LIBRARY_COPY, LIBRARY_PAGE_COPY } from '@/copy/screens'
import {
  emptyCopyOf,
  listNoticeOf,
  listStateOf,
  mergedOf,
  queryListStateOf,
  songCountOf,
} from '@/library/listState'

const READ = { libraries: [{ id: 1 }, { id: 2 }], isRead: true, failure: null }
const NO_MUSIC = { libraries: [], isRead: true, failure: null }
const READING = { libraries: [], isRead: false, failure: null }
const DOWN = new Error('raven is out of reach')

type AnsweredProps = { data: readonly number[] }

const answered = ({ data }: AnsweredProps) => ({ data, error: null, isSuccess: true })

const PENDING = { data: undefined, error: null, isSuccess: false }

const descending = (entries: readonly number[]): number[] => entries.toSorted((a, b) => b - a)

describe('mergedOf', () => {
  it("puts several libraries' entries in one order, and keeps one library's as the server sent them", () => {
    const several = mergedOf({
      music: READ,
      listings: [answered({ data: [1, 3] }), answered({ data: [2] })],
      order: descending,
    })
    expect(several).toEqual({ entries: [3, 2, 1], failure: null, isRead: true, hasNoMusic: false })
    const one = mergedOf({ music: READ, listings: [answered({ data: [1, 3] })], order: descending })
    expect(one.entries).toEqual([1, 3])
  })

  it('holds what is read so far and is not read until every library has answered', () => {
    const merged = mergedOf({
      music: READ,
      listings: [answered({ data: [1] }), PENDING],
      order: descending,
    })
    expect(merged).toMatchObject({ entries: [1], isRead: false, failure: null })
  })

  it("fails with the libraries' failure first, else the first listing's", () => {
    const failed = { data: undefined, error: DOWN, isSuccess: false }
    expect(mergedOf({ music: READ, listings: [failed], order: descending }).failure).toBe(DOWN)
    const libraries = new Error('no libraries')
    const music = { ...READING, failure: libraries }
    expect(mergedOf({ music, listings: [failed], order: descending }).failure).toBe(libraries)
  })
})

describe('listStateOf', () => {
  it('is read with no music once the libraries are, whatever its own read says', () => {
    expect(listStateOf({ music: NO_MUSIC, failure: null, isRead: false })).toEqual({
      failure: null,
      isRead: true,
      hasNoMusic: true,
    })
  })

  it('waits for the libraries and for its own read', () => {
    expect(listStateOf({ music: READING, failure: null, isRead: true }).isRead).toBe(false)
    expect(listStateOf({ music: READ, failure: null, isRead: false }).isRead).toBe(false)
    expect(listStateOf({ music: READ, failure: null, isRead: true }).isRead).toBe(true)
  })
})

describe('queryListStateOf', () => {
  it("reads one query's state as a list's, which no music library holds", () => {
    expect(queryListStateOf({ error: DOWN, isSuccess: false })).toEqual({
      failure: DOWN,
      isRead: false,
      hasNoMusic: false,
    })
  })
})

describe('listNoticeOf', () => {
  const empty = 'No albums yet'

  it('says a failure before anything else, then that the list is on its way', () => {
    const failed = { failure: DOWN, isRead: false, hasNoMusic: false }
    expect(listNoticeOf({ listing: failed, empty })).toBe(LIBRARY_PAGE_COPY.failed)
    const reading = { failure: null, isRead: false, hasNoMusic: false }
    expect(listNoticeOf({ listing: reading, empty })).toBe(KIT_COPY.loading)
  })

  it('says raven holds no music, or what the list says when it is empty', () => {
    const noMusic = { failure: null, isRead: true, hasNoMusic: true }
    expect(listNoticeOf({ listing: noMusic, empty })).toBe(LIBRARY_COPY.noMusic)
    const read = { failure: null, isRead: true, hasNoMusic: false }
    expect(listNoticeOf({ listing: read, empty })).toBe(empty)
  })
})

type Counted = { data: number; isSuccess: boolean }

describe('songCountOf', () => {
  const counted = (data: number): Counted => ({ data, isSuccess: true })

  it("adds up every library's count once each has answered", () => {
    expect(songCountOf({ music: READ, counts: [counted(4), counted(2)] })).toBe(6)
    expect(songCountOf({ music: NO_MUSIC, counts: [] })).toBe(0)
  })

  it('guesses no count before the libraries and every count have answered', () => {
    expect(songCountOf({ music: READING, counts: [] })).toBeNull()
    const pending = { data: undefined, isSuccess: false }
    expect(songCountOf({ music: READ, counts: [counted(4), pending] })).toBeNull()
  })
})

describe('emptyCopyOf', () => {
  const none = 'No albums yet.'

  it('says the list holds none when nothing was typed, else that nothing matches', () => {
    expect(emptyCopyOf({ query: '', none })).toBe(none)
    expect(emptyCopyOf({ query: 'radio', none })).toBe(LIBRARY_PAGE_COPY.noMatches)
  })
})
