import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
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
})
