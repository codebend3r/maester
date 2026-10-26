import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import type { Home } from '@raven/core'
import { queryClient } from '@/lib/queryClient'
import { HomePage } from '@/pages/HomePage/HomePage'
import {
  TEST_ACCOUNTS,
  authorizations,
  bearerOf,
  expectEveryCallAs,
  signInThrough,
  unanswered,
  useRecordedApi,
} from '@/test/accountSwitch'
import { mediaItem } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const { ada, bo } = TEST_ACCOUNTS

const PATHS = { home: '/api/home', libraries: '/api/libraries' } as const

type WatchingProps = { id: number; title: string }

const watching = ({ id, title }: WatchingProps): Home => ({
  inProgress: [{ media: mediaItem({ id, title, position: 60 }), poster: null }],
  shelves: [],
})

const ADAS = watching({ id: 101, title: 'Halfway through, for Ada' })
const BOS = watching({ id: 202, title: 'Halfway through, for Bo' })

describe('HomePage across accounts', () => {
  const api = useRecordedApi()

  const homeCalls = () => api.requests().filter(({ path }) => path === PATHS.home)

  it("drops the first account's continue watching when another signs in, and asks again as the second", async () => {
    const boHome = held<Home>()
    api.serve(async ({ path, authorization }) => {
      if (path === PATHS.libraries) return []
      if (path !== PATHS.home) return unanswered()
      return authorization === bearerOf(ada) ? ADAS : boHome.promise
    })
    const session = await signInThrough({ account: ada })
    renderWithProviders({ ui: <HomePage />, client: queryClient })
    expect(await screen.findByText('Halfway through, for Ada')).toBeInTheDocument()
    expect(authorizations(homeCalls())).toEqual([bearerOf(ada)])
    const before = api.requests().length

    await session.switchTo({ next: bo })

    await waitFor(() => expect(authorizations(homeCalls())).toEqual([bearerOf(ada), bearerOf(bo)]))
    expect(screen.queryByText('Halfway through, for Ada')).toBeNull()
    expect(screen.getByText('Gathering your libraries')).toBeInTheDocument()

    boHome.answer(BOS)
    expect(await screen.findByText('Halfway through, for Bo')).toBeInTheDocument()
    expect(screen.queryByText('Halfway through, for Ada')).toBeNull()
    expectEveryCallAs({ requests: api.requests().slice(before), account: bo })
  })
})
