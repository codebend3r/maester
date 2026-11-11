import {
  ITEM_TYPES,
  type MatchItemType,
  UPCOMING_PAGE_SIZE,
  UPCOMING_SHELVES,
  type UpcomingPage,
  type UpcomingShelf,
} from '@raven/core'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENTARY_FILTERS,
  type DocumentaryFilter,
  TMDB_ERROR_KINDS,
  type TmdbClient,
  TmdbError,
} from '@/metadata/tmdbClient'
import type { DiscoveredPage } from '@/metadata/tmdbShapes'
import { manualClock } from '@/test/clock'
import { cursorOf, UpcomingShelfPages } from '@/upcoming/upcomingShelfPages'
import { UPCOMING_FRESH_MS } from '@/upcoming/freshReads'

type Asked = Parameters<TmdbClient['soonest']>[0]

/** One result of a fake TMDB list: its id, its day, and whether it has a poster or a name at all. */
type Listed = { id: number; released: string; hasPoster?: boolean; isNamed?: boolean }

type ListKey = `${MatchItemType} ${DocumentaryFilter}`

type Lists = Partial<Record<ListKey, readonly Listed[]>>

type KeyOfProps = Pick<Asked, 'type' | 'documentaries'>

const keyOf = ({ type, documentaries }: KeyOfProps): ListKey => `${type} ${documentaries}`

type PageOfProps = { lists: Lists; asked: Asked }

/** TMDB's discover over `lists`: twenty results a page, in the order given. */
const pageOf = ({ lists, asked }: PageOfProps): DiscoveredPage => {
  const list = lists[keyOf(asked)] ?? []
  const results = list.slice((asked.page - 1) * 20, asked.page * 20)
  return {
    titles: results.flatMap(({ id, released, hasPoster = true, isNamed = true }, at) =>
      isNamed
        ? {
            at,
            title: {
              tmdbId: String(id),
              title: `Title ${id}`,
              released,
              poster: hasPoster ? `/p${id}.jpg` : null,
              popularity: 0,
            },
          }
        : [],
    ),
    size: results.length,
    total: list.length,
  }
}

type DayOf = (index: number) => string

type DaysProps = { from: number; count: number; day: DayOf } & Partial<Listed>

/** `count` results with ids from `from`, each out on the day `day` gives its index. */
const run = ({ from, count, day, ...rest }: DaysProps): Listed[] =>
  Array.from({ length: count }, (_, index) => ({ id: from + index, released: day(index), ...rest }))

/** The day `n` days after 2026-11-10. */
const dayAfter = (n: number): string =>
  new Date(Date.parse('2026-11-10T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

type Soonest = TmdbClient['soonest']

type SetUpProps = { lists: Lists; soonest?: Soonest }

const setUp = ({ lists, soonest }: SetUpProps) => {
  const asked: Asked[] = []
  const { clock, advance } = manualClock()
  advance(Date.parse('2026-11-10T15:00:00Z'))
  const pages = new UpcomingShelfPages(
    {
      soonest: (props) => {
        asked.push(props)
        return soonest?.(props) ?? Promise.resolve(pageOf({ lists, asked: props }))
      },
    },
    clock,
  )
  return { pages, asked, advance }
}

type ReadAllProps = { pages: UpcomingShelfPages; shelf: UpcomingShelf }

type StepProps = { after: string | null; read: readonly UpcomingPage[] }

/** Every page of `shelf`, first to last. */
const readAll = async ({ pages, shelf }: ReadAllProps): Promise<UpcomingPage[]> => {
  const step = async ({ after, read }: StepProps): Promise<UpcomingPage[]> => {
    const page = await pages.read({ shelf, after })
    if (page === null) throw new Error(`No page after ${after}`)
    const all = [...read, page]
    return page.next === null ? all : step({ after: page.next, read: all })
  }
  return step({ after: null, read: [] })
}

const MOVIES = keyOf({ type: ITEM_TYPES.movie, documentaries: DOCUMENTARY_FILTERS.never })
const DOCUMENTARY_MOVIES = keyOf({
  type: ITEM_TYPES.movie,
  documentaries: DOCUMENTARY_FILTERS.only,
})
const DOCUMENTARY_SHOWS = keyOf({ type: ITEM_TYPES.show, documentaries: DOCUMENTARY_FILTERS.only })

describe('UpcomingShelfPages', () => {
  it('pages through the movies from today on, the soonest first, to the last', async () => {
    const { pages, asked } = setUp({
      lists: { [MOVIES]: run({ from: 1, count: 55, day: (index) => dayAfter(index) }) },
    })
    const read = await readAll({ pages, shelf: UPCOMING_SHELVES.movies })
    const ids = read.flatMap((page) => page.titles.map((title) => Number(title.tmdbId)))
    expect(ids).toEqual(Array.from({ length: 55 }, (_, index) => index + 1))
    expect(read[0]?.titles).toHaveLength(UPCOMING_PAGE_SIZE)
    expect(read[0]?.titles[0]).toEqual({
      type: ITEM_TYPES.movie,
      tmdbId: '1',
      title: 'Title 1',
      released: '2026-11-10',
      poster: '/p1.jpg',
    })
    expect(read.at(-1)?.next).toBeNull()
    expect(new Set(asked.map((each) => each.from))).toEqual(new Set(['2026-11-10']))
    expect(new Set(asked.map((each) => each.documentaries))).toEqual(
      new Set([DOCUMENTARY_FILTERS.never]),
    )
  })

  it('leaves out titles with no poster, reading on to fill the page', async () => {
    const { pages } = setUp({
      lists: {
        [MOVIES]: [
          ...run({ from: 1, count: 15, day: () => dayAfter(0), hasPoster: false }),
          ...run({ from: 100, count: 30, day: () => dayAfter(1) }),
        ],
      },
    })
    const first = await pages.read({ shelf: UPCOMING_SHELVES.movies, after: null })
    expect(first?.titles.map((title) => Number(title.tmdbId))).toEqual(
      Array.from({ length: 20 }, (_, index) => 100 + index),
    )
    const second = await pages.read({ shelf: UPCOMING_SHELVES.movies, after: first?.next ?? '' })
    expect(second?.titles.map((title) => Number(title.tmdbId))).toEqual(
      Array.from({ length: 10 }, (_, index) => 120 + index),
    )
    expect(second?.next).toBeNull()
  })

  it('skips a result TMDB sent with no name or day without losing its place', async () => {
    const { pages } = setUp({
      lists: {
        [MOVIES]: [
          ...run({ from: 1, count: 19, day: () => dayAfter(0) }),
          { id: 50, released: dayAfter(0), isNamed: false },
          ...run({ from: 20, count: 25, day: () => dayAfter(1) }),
        ],
      },
    })
    const read = await readAll({ pages, shelf: UPCOMING_SHELVES.movies })
    const ids = read.flatMap((page) => page.titles.map((title) => Number(title.tmdbId)))
    expect(ids).toEqual(Array.from({ length: 44 }, (_, index) => index + 1))
  })

  it('merges documentary movies and shows by the day each comes out', async () => {
    const { pages } = setUp({
      lists: {
        [DOCUMENTARY_MOVIES]: run({ from: 1000, count: 50, day: (index) => dayAfter(index * 2) }),
        [DOCUMENTARY_SHOWS]: run({ from: 2000, count: 7, day: (index) => dayAfter(index * 3 + 1) }),
      },
    })
    const read = await readAll({ pages, shelf: UPCOMING_SHELVES.documentaries })
    const titles = read.flatMap((page) => page.titles)
    expect(titles).toHaveLength(57)
    const days = titles.map((title) => title.released)
    expect(days).toEqual(days.toSorted())
    expect(titles.slice(0, 3).map((title) => `${title.type} ${title.tmdbId}`)).toEqual([
      'movie 1000',
      'show 2000',
      'movie 1001',
    ])
  })

  it('never lets a page get ahead of a list it has not finished reading', async () => {
    const { pages } = setUp({
      lists: {
        [DOCUMENTARY_MOVIES]: run({ from: 1000, count: 60, day: () => dayAfter(0) }),
        [DOCUMENTARY_SHOWS]: run({ from: 2000, count: 5, day: () => dayAfter(5) }),
      },
    })
    const read = await readAll({ pages, shelf: UPCOMING_SHELVES.documentaries })
    const titles = read.flatMap((page) => page.titles)
    expect(titles.map((title) => title.type)).toEqual([
      ...Array.from({ length: 60 }, () => ITEM_TYPES.movie),
      ...Array.from({ length: 5 }, () => ITEM_TYPES.show),
    ])
  })

  it('answers an empty last page for a shelf TMDB lists nothing on', async () => {
    const { pages } = setUp({ lists: {} })
    expect(await pages.read({ shelf: UPCOMING_SHELVES.shows, after: null })).toEqual({
      titles: [],
      next: null,
    })
  })

  it('carries on from the day its cursor started, after midnight too', async () => {
    const { pages, asked, advance } = setUp({
      lists: { [MOVIES]: run({ from: 1, count: 30, day: (index) => dayAfter(index) }) },
    })
    const first = await pages.read({ shelf: UPCOMING_SHELVES.movies, after: null })
    advance(86_400_000)
    await pages.read({ shelf: UPCOMING_SHELVES.movies, after: first?.next ?? '' })
    expect(new Set(asked.map((each) => each.from))).toEqual(new Set(['2026-11-10']))
  })

  it('answers null for a cursor that is not one of the shelf', async () => {
    const { pages } = setUp({ lists: {} })
    expect(await pages.read({ shelf: UPCOMING_SHELVES.movies, after: 'tomorrow' })).toBeNull()
    expect(
      await pages.read({ shelf: UPCOMING_SHELVES.movies, after: '2026-11-10_20.4' }),
    ).toBeNull()
    expect(
      await pages.read({ shelf: UPCOMING_SHELVES.documentaries, after: '2026-11-10_20' }),
    ).toBeNull()
  })

  it('asks TMDB once for a page in six hours, and keeps no failed read', async () => {
    const state = { isFailing: true }
    const lists = { [MOVIES]: run({ from: 1, count: 10, day: () => dayAfter(0) }) }
    const { pages, asked, advance } = setUp({
      lists,
      soonest: async (props) => {
        if (state.isFailing) {
          throw new TmdbError({ kind: TMDB_ERROR_KINDS.unavailable, message: 'TMDB is down.' })
        }
        return pageOf({ lists, asked: props })
      },
    })
    await expect(pages.read({ shelf: UPCOMING_SHELVES.movies, after: null })).rejects.toThrow(
      'TMDB is down.',
    )
    state.isFailing = false
    await pages.read({ shelf: UPCOMING_SHELVES.movies, after: null })
    await pages.read({ shelf: UPCOMING_SHELVES.movies, after: null })
    expect(asked).toHaveLength(2)
    advance(UPCOMING_FRESH_MS)
    await pages.read({ shelf: UPCOMING_SHELVES.movies, after: null })
    expect(asked).toHaveLength(3)
  })
})

describe('cursorOf', () => {
  it('reads the day and an offset for each list', () => {
    expect(cursorOf({ after: '2026-11-10_40.13', streams: 2 })).toEqual({
      from: '2026-11-10',
      offsets: [40, 13],
    })
    expect(cursorOf({ after: '2026-11-10_-1', streams: 1 })).toBeNull()
  })
})
