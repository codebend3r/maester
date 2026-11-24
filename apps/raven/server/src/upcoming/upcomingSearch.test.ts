import { ITEM_TYPES, type MatchItemType, UPCOMING_SEARCH_SIZE, requestKeyOf } from '@raven/core'
import { describe, expect, it } from 'vitest'
import type { DiscoveredTitle } from '@/metadata/tmdbShapes'
import { UpcomingSearch } from '@/upcoming/upcomingSearch'

type TitleProps = {
  id: number
  released: string
  popularity: number
  poster?: string | null
}

const found = ({
  id,
  released,
  popularity,
  poster = `/p${id}.jpg`,
}: TitleProps): DiscoveredTitle => ({
  tmdbId: String(id),
  title: `Title ${id}`,
  released,
  poster,
  popularity,
  genreIds: [],
  originalLanguage: null,
})

type SetUpProps = {
  answers: Record<MatchItemType, DiscoveredTitle[]>
  held?: readonly string[]
}

const setUp = ({ answers, held = [] }: SetUpProps) => {
  const asked: string[] = []
  const search = new UpcomingSearch(
    {
      searchDated: async ({ type, query }) => {
        asked.push(`${type}:${query}`)
        return answers[type]
      },
    },
    { heldOf: (asks) => new Set(asks.map(requestKeyOf).filter((key) => held.includes(key))) },
  )
  return { search, asked }
}

describe('UpcomingSearch', () => {
  it('keeps movies and shows with a poster, out already or still to come, the most popular first', async () => {
    const { search, asked } = setUp({
      answers: {
        [ITEM_TYPES.movie]: [
          found({ id: 1, released: '2000-05-05', popularity: 90 }),
          found({ id: 2, released: '2026-11-15', popularity: 10 }),
          found({ id: 3, released: '2027-01-01', popularity: 50, poster: null }),
        ],
        [ITEM_TYPES.show]: [found({ id: 4, released: '2026-12-01', popularity: 40 })],
      },
    })
    const { titles } = await search.search('gladiator')
    expect(titles.map(({ type, tmdbId }) => `${type}:${tmdbId}`)).toEqual([
      'movie:1',
      'show:4',
      'movie:2',
    ])
    expect(titles[1]).toEqual({
      type: ITEM_TYPES.show,
      tmdbId: '4',
      title: 'Title 4',
      released: '2026-12-01',
      poster: '/p4.jpg',
    })
    expect(asked.toSorted()).toEqual(['movie:gladiator', 'show:gladiator'])
  })

  it('leaves out what a library holds already', async () => {
    const { search } = setUp({
      answers: {
        [ITEM_TYPES.movie]: [
          found({ id: 1, released: '2027-01-01', popularity: 90 }),
          found({ id: 2, released: '2027-01-01', popularity: 80 }),
        ],
        [ITEM_TYPES.show]: [],
      },
      held: ['movie:1'],
    })
    const { titles } = await search.search('dune')
    expect(titles.map((title) => title.tmdbId)).toEqual(['2'])
  })

  it(`answers ${UPCOMING_SEARCH_SIZE} at most, and asks TMDB nothing for a blank query`, async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      found({ id: index + 1, released: '2027-01-01', popularity: 100 - index }),
    )
    const { search } = setUp({
      answers: { [ITEM_TYPES.movie]: many, [ITEM_TYPES.show]: [] },
    })
    expect((await search.search('a')).titles).toHaveLength(UPCOMING_SEARCH_SIZE)
    const blank = setUp({ answers: { [ITEM_TYPES.movie]: many, [ITEM_TYPES.show]: [] } })
    expect(await blank.search.search('   ')).toEqual({ titles: [] })
    expect(blank.asked).toEqual([])
  })
})
