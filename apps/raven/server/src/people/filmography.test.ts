import type { ItemSummary, ItemType } from '@raven/core'
import { describe, expect, it } from 'vitest'
import type { LocalCredit } from '@/metadata/metadataRepository'
import { departmentOf, isSelfAppearance, toEntries } from '@/people/filmography'
import type { FilmographyRow } from '@/people/peopleRepository'

const row = (
  fields: Partial<FilmographyRow> & Pick<FilmographyRow, 'tmdbId' | 'title'>,
): FilmographyRow => ({
  type: 'movie',
  released: null,
  poster: null,
  genreIds: [],
  department: 'Acting',
  role: null,
  episodes: null,
  itemId: null,
  ...fields,
})

const summary = ({
  id,
  title,
  type = 'movie',
  year = 1999,
}: {
  id: number
  title: string
  type?: ItemType
  year?: number
}): ItemSummary => ({
  id,
  type,
  title,
  year,
  show: null,
  season: null,
  episode: null,
  posterVersion: null,
  backdropVersion: null,
  ratings: [],
})

/** Nothing held, nothing seen, no local credits: what each test then adds to. */
const NONE = {
  holding: new Map<number, number[]>(),
  sees: () => true,
  summaries: new Map<number, ItemSummary>(),
  localCredits: [],
} as const satisfies Omit<Parameters<typeof toEntries>[0], 'rows'>

describe("a credit's department", () => {
  it.each([
    { department: 'Acting', role: 'Neo', expected: 'acting' },
    { department: 'Acting', role: 'The Producer', expected: 'acting' },
    { department: 'Production', role: 'Executive Producer', expected: 'producing' },
    { department: 'Production', role: 'Producer', expected: 'producing' },
    { department: 'Production', role: 'Executive Co-Producer', expected: 'producing' },
    { department: 'Directing', role: 'Director', expected: 'directing' },
    { department: 'Writing', role: 'Screenplay', expected: 'writing' },
    { department: 'Creator', role: 'Original Concept', expected: 'writing' },
    { department: 'Production', role: 'Creator', expected: 'writing' },
    { department: 'Production', role: 'Production Manager', expected: 'crew' },
    { department: 'Editing', role: 'Editor', expected: 'crew' },
  ])('files $role in $department under $expected', ({ department, role, expected }) => {
    expect(departmentOf({ department, role })).toBe(expected)
  })
})

describe('an appearance as themselves', () => {
  it.each(['Self', 'Self - Guest', 'Himself (archive footage)', 'Host'])('is one as %s', (role) => {
    expect(isSelfAppearance({ department: 'Acting', role, genreIds: [18] })).toBe(true)
  })

  it('is any part on a talk show', () => {
    expect(isSelfAppearance({ department: 'Acting', role: 'Ted', genreIds: [35, 10767] })).toBe(
      true,
    )
  })

  it('is not a narrator, a character in a drama, or work behind the camera', () => {
    expect(
      isSelfAppearance({ department: 'Acting', role: 'Narrator (voice)', genreIds: [99] }),
    ).toBe(false)
    expect(isSelfAppearance({ department: 'Acting', role: 'Neo', genreIds: [18] })).toBe(false)
    expect(isSelfAppearance({ department: 'Production', role: 'Self', genreIds: [10767] })).toBe(
      false,
    )
  })
})

describe("a filmography's entries", () => {
  it('makes one entry of every credit on a title, acting first', () => {
    const entries = toEntries({
      ...NONE,
      rows: [
        row({
          type: 'show',
          tmdbId: '9100',
          title: 'Dogstar',
          department: 'Production',
          role: 'Executive Producer',
        }),
        row({ type: 'show', tmdbId: '9100', title: 'Dogstar', role: 'Bassist', episodes: 12 }),
        row({ type: 'show', tmdbId: '9100', title: 'Dogstar', role: 'Himself', episodes: 2 }),
        row({ type: 'movie', tmdbId: '9100', title: 'Dogstar: The Movie' }),
      ],
    })
    expect(entries.map((entry) => `${entry.type}:${entry.tmdbId}`)).toEqual([
      'show:9100',
      'movie:9100',
    ])
    expect(entries[0]?.credits).toEqual([
      { department: 'acting', role: 'Bassist', episodes: 12, isSelf: false },
      { department: 'acting', role: 'Himself', episodes: 2, isSelf: true },
      { department: 'producing', role: 'Executive Producer', episodes: null, isSelf: false },
    ])
  })

  it("keeps the first credit's title, date and poster, with the year of that date", () => {
    const [entry] = toEntries({
      ...NONE,
      rows: [
        row({ tmdbId: '1', title: 'First', released: '2001-02-03', poster: '/first.jpg' }),
        row({ tmdbId: '1', title: 'Second', released: '2005-01-01', poster: '/second.jpg' }),
      ],
    })
    expect(entry).toMatchObject({
      title: 'First',
      released: '2001-02-03',
      year: 2001,
      poster: '/first.jpg',
    })
  })

  it('leaves out thanks and dedications, and a title with nothing else', () => {
    const entries = toEntries({
      ...NONE,
      rows: [
        row({ tmdbId: '1', title: 'Thanked', department: 'Crew', role: 'Thanks' }),
        row({ tmdbId: '2', title: 'Remembered', department: 'Crew', role: 'In Memory Of' }),
        row({ tmdbId: '3', title: 'Worked On', department: 'Crew', role: 'Thanks' }),
        row({ tmdbId: '3', title: 'Worked On', department: 'Crew', role: 'Stunts' }),
      ],
    })
    expect(entries.map((entry) => entry.title)).toEqual(['Worked On'])
    expect(entries[0]?.credits.map((credit) => credit.role)).toEqual(['Stunts'])
  })

  it('names the item only when a library the viewer sees holds a file of it', () => {
    const entries = toEntries({
      rows: [
        row({ tmdbId: '1', title: 'Open', itemId: 10 }),
        row({ tmdbId: '2', title: 'Locked', itemId: 20 }),
        row({ tmdbId: '3', title: 'No File', itemId: 30 }),
        row({ tmdbId: '4', title: 'Not Stored' }),
      ],
      holding: new Map([
        [10, [1]],
        [20, [2]],
      ]),
      sees: (libraryId) => libraryId === 1,
      summaries: new Map([
        [10, summary({ id: 10, title: 'Open' })],
        [20, summary({ id: 20, title: 'Locked' })],
        [30, summary({ id: 30, title: 'No File' })],
      ]),
      localCredits: [],
    })
    expect(
      Object.fromEntries(entries.map((entry) => [entry.title, entry.item?.id ?? null])),
    ).toEqual({ Open: 10, Locked: null, 'No File': null, 'Not Stored': null })
  })

  it('adds the credits raven holds on a title TMDB does not list, dated as the item is', () => {
    const heat = summary({ id: 40, title: 'Heat', year: 1995 })
    const listed = summary({ id: 10, title: 'Listed' })
    const localCredits: LocalCredit[] = [
      { item: heat, job: 'cast', role: 'Neil', tmdbId: '949', released: '1995-12-15' },
      { item: heat, job: 'producer', role: null, tmdbId: '949', released: '1995-12-15' },
      { item: listed, job: 'cast', role: 'Neo', tmdbId: '603', released: '1999-03-31' },
    ]
    const entries = toEntries({
      ...NONE,
      rows: [
        row({ tmdbId: '603', title: 'Listed', itemId: 10, released: '1999-03-31' }),
        row({ tmdbId: '2', title: 'Newer', released: '2024-05-01' }),
      ],
      localCredits,
    })
    expect(entries).toEqual([
      expect.objectContaining({ title: 'Newer' }),
      expect.objectContaining({ title: 'Listed', item: null }),
      {
        type: 'movie',
        tmdbId: '949',
        title: 'Heat',
        year: 1995,
        released: '1995-12-15',
        poster: null,
        credits: [
          { department: 'acting', role: 'Neil', episodes: null, isSelf: false },
          { department: 'producing', role: null, episodes: null, isSelf: false },
        ],
        item: heat,
      },
    ])
  })

  it("adds raven's credit to a title TMDB lists, in a department TMDB lists none of theirs in", () => {
    const matrix = summary({ id: 10, title: 'The Matrix' })
    const [entry] = toEntries({
      ...NONE,
      rows: [
        row({
          tmdbId: '603',
          title: 'The Matrix',
          itemId: 10,
          department: 'Production',
          role: 'Executive Producer',
        }),
      ],
      holding: new Map([[10, [1]]]),
      summaries: new Map([[10, matrix]]),
      localCredits: [
        { item: matrix, job: 'cast', role: 'Neo', tmdbId: '603', released: '1999-03-31' },
      ],
    })
    expect(entry?.credits).toEqual([
      { department: 'acting', role: 'Neo', episodes: null, isSelf: false },
      { department: 'producing', role: 'Executive Producer', episodes: null, isSelf: false },
    ])
    expect(entry?.item).toBe(matrix)
  })

  it("adds nothing of raven's to a title TMDB lists in that department already", () => {
    const matrix = summary({ id: 10, title: 'The Matrix' })
    const entries = toEntries({
      ...NONE,
      rows: [row({ tmdbId: '603', title: 'The Matrix', itemId: 10, role: 'Neo' })],
      localCredits: [
        { item: matrix, job: 'cast', role: 'Thomas Anderson', tmdbId: '603', released: null },
      ],
    })
    expect(entries.map((entry) => entry.credits)).toEqual([
      [{ department: 'acting', role: 'Neo', episodes: null, isSelf: false }],
    ])
  })

  it('lists undated titles first, then the newest, then by title', () => {
    const entries = toEntries({
      ...NONE,
      rows: [
        row({ tmdbId: '1', title: 'Old', released: '1990-01-01' }),
        row({ tmdbId: '2', title: 'Zed Upcoming' }),
        row({ tmdbId: '3', title: 'Newest', released: '2024-05-01' }),
        row({ tmdbId: '4', title: 'Beta', released: '2010-06-01' }),
        row({ tmdbId: '5', title: 'Alpha', released: '2010-06-01' }),
        row({ tmdbId: '6', title: 'Upcoming' }),
      ],
    })
    expect(entries.map((entry) => entry.title)).toEqual([
      'Upcoming',
      'Zed Upcoming',
      'Newest',
      'Alpha',
      'Beta',
      'Old',
    ])
  })
})
