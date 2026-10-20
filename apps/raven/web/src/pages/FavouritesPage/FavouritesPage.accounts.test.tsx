import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { ITEM_TYPES, type ItemSummary, type PosterEntry } from '@raven/core'
import { queryClient } from '@/lib/queryClient'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import {
  TEST_ACCOUNTS,
  authorizations,
  bearerOf,
  expectEveryCallAs,
  signInThrough,
  unanswered,
  useRecordedApi,
} from '@/test/accountSwitch'
import { itemSummary, mediaItem } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const { ada, bo } = TEST_ACCOUNTS

const PATHS = { videos: '/api/favourites', titles: '/api/favourites/titles' } as const

const videoOf = (title: string): PosterEntry[] => [
  { media: mediaItem({ id: title.length, title, favourite: true }), poster: null },
]

const ADAS_VIDEOS = videoOf('Ada favourite video')
const BOS_VIDEOS = videoOf('Bo favourite video')
const ADAS_TITLES: ItemSummary[] = [
  itemSummary({ id: 90, type: ITEM_TYPES.show, title: 'Ada favourite show' }),
]
const BOS_TITLES: ItemSummary[] = [
  itemSummary({ id: 91, type: ITEM_TYPES.show, title: 'Bo favourite show' }),
]

describe('FavouritesPage across accounts', () => {
  const api = useRecordedApi()

  const callsTo = (path: string) => api.requests().filter((request) => request.path === path)

  it("drops the first account's favourites when another signs in, and asks again as the second", async () => {
    const boVideos = held<PosterEntry[]>()
    const boTitles = held<ItemSummary[]>()
    api.serve(async ({ path, authorization }) => {
      const isAda = authorization === bearerOf(ada)
      if (path === PATHS.videos) return isAda ? ADAS_VIDEOS : boVideos.promise
      if (path === PATHS.titles) return isAda ? ADAS_TITLES : boTitles.promise
      return unanswered()
    })
    const session = await signInThrough({ account: ada })
    renderWithProviders({ ui: <FavouritesPage />, client: queryClient })
    expect(await screen.findByText('Ada favourite video')).toBeInTheDocument()
    expect(await screen.findByText(/Ada favourite show/)).toBeInTheDocument()
    const before = api.requests().length

    await session.switchTo({ next: bo })

    await waitFor(() => {
      expect(authorizations(callsTo(PATHS.videos))).toEqual([bearerOf(ada), bearerOf(bo)])
      expect(authorizations(callsTo(PATHS.titles))).toEqual([bearerOf(ada), bearerOf(bo)])
    })
    expect(screen.queryByText('Ada favourite video')).toBeNull()
    expect(screen.queryByText(/Ada favourite show/)).toBeNull()

    boVideos.answer(BOS_VIDEOS)
    boTitles.answer(BOS_TITLES)
    expect(await screen.findByText('Bo favourite video')).toBeInTheDocument()
    expect(await screen.findByText(/Bo favourite show/)).toBeInTheDocument()
    expect(screen.queryByText('Ada favourite video')).toBeNull()
    expectEveryCallAs({ requests: api.requests().slice(before), account: bo })
  })
})
