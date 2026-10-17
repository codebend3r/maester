import { describe, expect, it } from 'bun:test'
import { type FilmographyCredit, type FilmographyEntry } from '@/contract'
import { ageOn, entriesOn, isFilmographyTab, selfCount, tabCounts } from '@/filmography'

const credit = (overrides: Partial<FilmographyCredit> = {}): FilmographyCredit => ({
  department: 'acting',
  role: null,
  episodes: null,
  isSelf: false,
  ...overrides,
})

const entry = (overrides: Partial<FilmographyEntry> = {}): FilmographyEntry => ({
  type: 'movie',
  tmdbId: '603',
  title: 'The Matrix',
  year: 1999,
  released: '1999-03-31',
  poster: null,
  credits: [credit({ role: 'Neo' })],
  item: null,
  ...overrides,
})

const MATRIX = entry({
  credits: [credit({ role: 'Neo' }), credit({ department: 'producing' })],
})
const TALK_SHOW = entry({
  type: 'show',
  tmdbId: '1',
  title: 'The Late Show',
  credits: [credit({ role: 'Himself', isSelf: true, episodes: 3 })],
})
const SCREENPLAY = entry({
  tmdbId: '2',
  title: 'Bram',
  credits: [credit({ department: 'writing' })],
})
const ENTRIES = [MATRIX, TALK_SHOW, SCREENPLAY]

describe('entriesOn', () => {
  it('drops an entry of only selves from all while they are hidden, and keeps the order', () => {
    expect(
      entriesOn({ entries: ENTRIES, tab: 'all', isSelfShown: false }).map((e) => e.title),
    ).toEqual(['The Matrix', 'Bram'])
  })

  it("keeps only a tab's department of an entry's credits", () => {
    const [matrix] = entriesOn({ entries: ENTRIES, tab: 'acting', isSelfShown: false })
    expect(matrix?.credits.map((c) => c.department)).toEqual(['acting'])
    expect(entriesOn({ entries: ENTRIES, tab: 'producing', isSelfShown: false })).toHaveLength(1)
  })

  it('brings the talk-show entry back when selves are shown', () => {
    expect(
      entriesOn({ entries: ENTRIES, tab: 'all', isSelfShown: true }).map((e) => e.title),
    ).toEqual(['The Matrix', 'The Late Show', 'Bram'])
  })

  it('lists crew credits on all only', () => {
    const crew = entry({ credits: [credit({ department: 'crew' })] })
    expect(entriesOn({ entries: [crew], tab: 'all', isSelfShown: false })).toHaveLength(1)
    expect(entriesOn({ entries: [crew], tab: 'acting', isSelfShown: false })).toHaveLength(0)
  })

  it('leaves the entries it was given as they were', () => {
    entriesOn({ entries: ENTRIES, tab: 'acting', isSelfShown: false })
    expect(MATRIX.credits).toHaveLength(2)
  })
})

describe('tabCounts', () => {
  it('counts the entries each tab lists', () => {
    expect(tabCounts({ entries: ENTRIES, isSelfShown: false })).toEqual({
      all: 2,
      acting: 1,
      directing: 0,
      writing: 1,
      producing: 1,
    })
    expect(tabCounts({ entries: ENTRIES, isSelfShown: true })).toEqual({
      all: 3,
      acting: 2,
      directing: 0,
      writing: 1,
      producing: 1,
    })
  })
})

describe('selfCount', () => {
  it('counts the entries all of whose credits are as themselves', () => {
    expect(selfCount(ENTRIES)).toBe(1)
    expect(
      selfCount([
        entry({ credits: [credit({ isSelf: true }), credit({ department: 'writing' })] }),
      ]),
    ).toBe(0)
    expect(selfCount([])).toBe(0)
  })
})

describe('isFilmographyTab', () => {
  it('accepts the tabs and not crew', () => {
    expect(isFilmographyTab('all')).toBe(true)
    expect(isFilmographyTab('crew')).toBe(false)
  })
})

describe('ageOn', () => {
  it('counts whole years, a birthday not yet come not included', () => {
    expect(ageOn({ birthday: '2000-11-21', on: '2026-10-17' })).toBe(25)
    expect(ageOn({ birthday: '2000-11-21', on: '2026-11-21' })).toBe(26)
    expect(ageOn({ birthday: '1956-07-09', on: '2026-07-08' })).toBe(69)
  })

  it('is null for a missing or malformed date', () => {
    expect(ageOn({ birthday: null, on: '2026-10-17' })).toBeNull()
    expect(ageOn({ birthday: '2000-11-21', on: null })).toBeNull()
    expect(ageOn({ birthday: '2000-11', on: '2026-10-17' })).toBeNull()
    expect(ageOn({ birthday: '2000-11-21', on: 'yesterday' })).toBeNull()
  })
})
