import { ITEM_TYPES, type MatchItemType } from '@raven/core'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENTARY_FILTERS,
  TMDB_ERROR_KINDS,
  type TmdbClient,
  TmdbError,
} from '@/metadata/tmdbClient'
import type { DiscoveredTitle } from '@/metadata/tmdbShapes'
import { manualClock } from '@/test/clock'
import { UPCOMING_FRESH_MS } from '@/upcoming/freshReads'
import { UpcomingTitles } from '@/upcoming/upcomingTitles'

type Asked = Parameters<TmdbClient['upcoming']>[0]

type TitleProps = { id: number; popularity: number; poster?: string | null }

const title = ({ id, popularity, poster = `/p${id}.jpg` }: TitleProps): DiscoveredTitle => ({
  tmdbId: String(id),
  title: `Title ${id}`,
  released: '2026-12-25',
  poster,
  popularity,
})

type PageOfProps = { from: number; count: number }

/** A page of `count` titles, ids from `from`, each less popular than the one before. */
const pageOf = ({ from, count }: PageOfProps): DiscoveredTitle[] =>
  Array.from({ length: count }, (_, index) => title({ id: from + index, popularity: 1000 - index }))

/** Where each kind of shelf's ids start, so a test can tell whose title a card is. */
const FIRST_IDS = {
  [ITEM_TYPES.movie]: 1000,
  [ITEM_TYPES.show]: 2000,
} as const satisfies Record<MatchItemType, number>

const answer = ({ type, documentaries, page }: Asked): DiscoveredTitle[] =>
  documentaries === DOCUMENTARY_FILTERS.only
    ? pageOf({ from: FIRST_IDS[type] + 900, count: 20 })
    : pageOf({ from: FIRST_IDS[type] + (page - 1) * 20, count: 20 })

type SetUpProps = { upcoming?: (asked: Asked) => Promise<DiscoveredTitle[]> }

const setUp = ({ upcoming = async (asked) => answer(asked) }: SetUpProps = {}) => {
  const asked: Asked[] = []
  const { clock, advance } = manualClock()
  advance(Date.parse('2026-11-10T15:00:00Z'))
  const titles = new UpcomingTitles(
    {
      upcoming: (props) => {
        asked.push(props)
        return upcoming(props)
      },
    },
    clock,
  )
  return { titles, asked, advance }
}

describe('UpcomingTitles', () => {
  it('fills two rows of movies and of shows and one of documentaries, from today on', async () => {
    const { titles, asked } = setUp()
    const upcoming = await titles.read()
    expect(upcoming.movies).toHaveLength(16)
    expect(upcoming.shows).toHaveLength(16)
    expect(upcoming.documentaries).toHaveLength(8)
    expect(upcoming.movies[0]).toEqual({
      type: ITEM_TYPES.movie,
      tmdbId: '1000',
      title: 'Title 1000',
      released: '2026-12-25',
      poster: '/p1000.jpg',
    })
    expect(upcoming.shows.every((show) => show.type === ITEM_TYPES.show)).toBe(true)
    expect(new Set(asked.map((each) => each.from))).toEqual(new Set(['2026-11-10']))
  })

  it('mixes documentary movies and shows by popularity', async () => {
    const { titles } = setUp({
      upcoming: async ({ type, documentaries }) => {
        if (documentaries === DOCUMENTARY_FILTERS.never) return []
        return type === ITEM_TYPES.movie
          ? [title({ id: 1, popularity: 5 }), title({ id: 2, popularity: 1 })]
          : [title({ id: 3, popularity: 9 })]
      },
    })
    const { documentaries } = await titles.read()
    expect(documentaries.map((each) => `${each.type} ${each.tmdbId}`)).toEqual([
      'show 3',
      'movie 1',
      'movie 2',
    ])
  })

  it('leaves out a title with no poster yet, and one TMDB lists twice', async () => {
    const { titles } = setUp({
      upcoming: async ({ type, documentaries, page }) =>
        type === ITEM_TYPES.movie && documentaries === DOCUMENTARY_FILTERS.never && page === 1
          ? [
              title({ id: 1, popularity: 9 }),
              title({ id: 1, popularity: 9 }),
              title({ id: 2, popularity: 8, poster: null }),
              title({ id: 3, popularity: 7 }),
            ]
          : [],
    })
    const { movies } = await titles.read()
    expect(movies.map((movie) => movie.tmdbId)).toEqual(['1', '3'])
  })

  it('asks TMDB once for everyone, and again once six hours have passed', async () => {
    const { titles, asked, advance } = setUp()
    await Promise.all([titles.read(), titles.read()])
    const first = asked.length
    expect(first).toBe(6)
    advance(UPCOMING_FRESH_MS - 1)
    await titles.read()
    expect(asked).toHaveLength(first)
    advance(1)
    await titles.read()
    expect(asked).toHaveLength(first * 2)
  })

  it('keeps no failed read, so the next view asks again', async () => {
    const state = { isFailing: true }
    const { titles } = setUp({
      upcoming: async (asked) => {
        if (state.isFailing) {
          throw new TmdbError({ kind: TMDB_ERROR_KINDS.unavailable, message: 'TMDB is down.' })
        }
        return answer(asked)
      },
    })
    await expect(titles.read()).rejects.toThrow('TMDB is down.')
    state.isFailing = false
    expect((await titles.read()).movies).toHaveLength(16)
  })
})
