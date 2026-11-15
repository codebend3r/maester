import { describe, expect, it } from 'bun:test'
import { type FilmographyCredit, type FilmographyEntry } from '@raven/core'
import {
  entriesOn,
  hasSelfCredits,
  isFilmographyTab,
  selfCount,
  tabCounts,
} from '@/pages/PersonPage/filmographyTabs'

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

describe('hasSelfCredits', () => {
  it('is true for a credit as themselves, alone on its title or beside other work', () => {
    expect(hasSelfCredits(ENTRIES)).toBe(true)
    const mixed = entry({
      title: 'Five Came Back',
      credits: [credit({ role: 'Self', isSelf: true }), credit({ department: 'producing' })],
    })
    expect(selfCount([MATRIX, mixed])).toBe(0)
    expect(hasSelfCredits([MATRIX, mixed])).toBe(true)
  })

  it('is false with no credit as themselves', () => {
    expect(hasSelfCredits([MATRIX, SCREENPLAY])).toBe(false)
    expect(hasSelfCredits([])).toBe(false)
  })
})

describe('isFilmographyTab', () => {
  it('accepts the tabs and not crew', () => {
    expect(isFilmographyTab('all')).toBe(true)
    expect(isFilmographyTab('crew')).toBe(false)
  })
})
