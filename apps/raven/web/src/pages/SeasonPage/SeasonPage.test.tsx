import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemDetails } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { SeasonPage } from '@/pages/SeasonPage/SeasonPage'
import { renderWithProviders } from '@/test/render'
import { SEASON_ONE, SEVERANCE } from '@/test/tv'

describe('SeasonPage', () => {
  const spies = { item: spyOn(api, 'getItem') }

  const open = (route = '/shows/4/seasons/1') => {
    spies.item.mockImplementation(async (id) => {
      if (id === 4) return SEVERANCE
      if (id === 5) return SEASON_ONE
      throw new Error(`no item ${id}`)
    })
    renderWithProviders(
      <Routes>
        <Route path="shows/:id/seasons/:number" element={<SeasonPage />} />
      </Routes>,
      { route },
    )
  }

  afterEach(() => spies.item.mockReset())

  it('lists the episodes on disk in order, each with its air date, length and Play', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Season 1' })).toBeInTheDocument()
    expect(screen.getByText('2 episodes')).toBeInTheDocument()
    const list = await screen.findByRole('list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(
      within(rows[0] ?? list).getByRole('link', { name: '1. Good News About Hell' }),
    ).toHaveAttribute('href', '/episodes/6')
    expect(await within(rows[0] ?? list).findByText(/18 Feb 2022|Feb 18, 2022/)).toBeInTheDocument()
    expect(within(rows[0] ?? list).getByText('57m')).toBeInTheDocument()
    expect(within(rows[1] ?? list).getByRole('link', { name: 'Play Half Loop' })).toHaveAttribute(
      'href',
      '/watch/13',
    )
    expect(within(rows[1] ?? list).getByText('Partly watched')).toBeInTheDocument()
  })

  it('shows every row from the season alone, asking for no episode', async () => {
    open()
    const list = await screen.findByRole('list')
    const [first] = within(list).getAllByRole('listitem')
    expect(
      within(first ?? list).getByText('Good News About Hell is an episode.'),
    ).toBeInTheDocument()
    expect(first?.querySelector('img')?.getAttribute('src')).toContain('/images/still?v=still1')
    expect(spies.item.mock.calls.map(([id]) => id).toSorted()).toEqual([4, 5])
  })

  it('is not found for a season the show has no files of', async () => {
    open('/shows/4/seasons/3')
    expect(
      await screen.findByRole('heading', { name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
  })

  const withWatched = (watched: boolean[]): ItemDetails => ({
    ...SEASON_ONE,
    children: SEASON_ONE.children.map((child, index) =>
      child.type === 'episode' ? { ...child, watched: watched[index] ?? false } : child,
    ),
  })

  const openWith = (season: ItemDetails) => {
    spies.item.mockImplementation(async (id) => {
      if (id === 4) return SEVERANCE
      if (id === 5) return season
      throw new Error(`no item ${id}`)
    })
    renderWithProviders(
      <Routes>
        <Route path="shows/:id/seasons/:number" element={<SeasonPage />} />
      </Routes>,
      { route: '/shows/4/seasons/1' },
    )
  }

  it('reads as partly pressed when some episodes are watched', async () => {
    openWith(withWatched([true, false]))
    expect(await screen.findByRole('button', { name: 'Watched' })).toHaveAttribute(
      'aria-pressed',
      'mixed',
    )
  })

  it('marks the whole season watched from a partly watched one, then unwatched', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    openWith(withWatched([true, false]))
    await userEvent.click(await screen.findByRole('button', { name: 'Watched' }))
    cleanup()
    openWith(withWatched([true, true]))
    await userEvent.click(await screen.findByRole('button', { name: 'Watched' }))
    set.mockRestore()
    const targets = [{ kind: 'item', id: 5, libraryId: null }]
    expect(calls).toEqual([
      { watched: true, targets },
      { watched: false, targets },
    ])
  })

  it('gives each episode row its own toggle, sending that episode', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    openWith(withWatched([true, false]))
    const first = await screen.findByRole('button', { name: 'Watched Good News About Hell' })
    const second = screen.getByRole('button', { name: 'Watched Half Loop' })
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(second).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(second)
    await userEvent.click(first)
    set.mockRestore()
    expect(calls).toEqual([
      { watched: true, targets: [{ kind: 'item', id: 7, libraryId: null }] },
      { watched: false, targets: [{ kind: 'item', id: 6, libraryId: null }] },
    ])
  })

  it('draws the check on a watched episode’s still', async () => {
    openWith(withWatched([true, false]))
    const list = await screen.findByRole('list')
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first?.querySelector('a[aria-hidden] svg')).not.toBeNull()
    expect(second?.querySelector('a[aria-hidden] svg')).toBeNull()
  })

  it('selects its episode rows from a Select button, and marks them by item', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    expect(screen.queryByRole('link', { name: 'Play Half Loop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Watched Half Loop' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '1. Good News About Hell' }))
    expect(screen.queryByText('Good News About Hell is an episode.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Half Loop' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    set.mockRestore()
    expect(calls).toEqual([
      {
        watched: true,
        targets: [
          { kind: 'item', id: 6, libraryId: null },
          { kind: 'item', id: 7, libraryId: null },
        ],
      },
    ])
  })
})
