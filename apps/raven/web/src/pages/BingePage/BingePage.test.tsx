import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, ITEM_TYPES, type ItemDetails } from '@raven/core'
import { createQueryClient } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { BINGE_COPY } from '@/lib/binge'
import { BingePage, BingeSection } from '@/pages/BingePage/BingePage'
import { useBinge } from '@/stores/binge'
import { itemDetails } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const mark = (id: number) =>
  useBinge.getState().toggle({ account: 'local', item: { id, type: ITEM_TYPES.show } })

describe('BingePage', () => {
  const item = spyOn(api, 'getItem')
  afterEach(() => {
    cleanup()
    item.mockReset()
  })

  it('explains binge mode with a library link when no shows are selected', () => {
    renderWithProviders({ ui: <BingePage /> })
    expect(screen.getByRole('heading', { name: BINGE_COPY.emptyTitle })).toBeInTheDocument()
    expect(screen.getByText(BINGE_COPY.emptyBody)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: BINGE_COPY.browse })).toHaveAttribute(
      'href',
      '/libraries',
    )
    expect(item).not.toHaveBeenCalled()
  })

  it('renders nothing on home when no shows are selected', () => {
    renderWithProviders({ ui: <BingeSection isHome /> })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('lists only shows the server still allows, newest selection first', async () => {
    mark(1)
    mark(2)
    item.mockImplementation(async (id) =>
      itemDetails({ id, type: ITEM_TYPES.show, title: `Series ${id}` }),
    )
    renderWithProviders({ ui: <BingePage /> })
    await screen.findByRole('link', { name: /Series 1/ })
    expect(screen.getAllByRole('listitem').map((entry) => entry.textContent)).toEqual([
      expect.stringContaining('Series 2'),
      expect.stringContaining('Series 1'),
    ])
  })

  it('shows loading on its page but hides the home section until a show arrives', async () => {
    mark(1)
    item.mockImplementation(() => held<ItemDetails>().promise)
    const view = renderWithProviders({ ui: <BingeSection isHome /> })
    expect(screen.queryByRole('region')).toBeNull()
    view.unmount()
    renderWithProviders({ ui: <BingePage /> })
    expect(screen.getByText(BINGE_COPY.loading)).toBeInTheDocument()
  })

  it('does not show failed or non-show entries on home', async () => {
    mark(1)
    mark(2)
    item.mockImplementation(async (id) => {
      if (id === 1) throw new Error('Access denied')
      return itemDetails({ id, type: ITEM_TYPES.movie })
    })
    renderWithProviders({ ui: <BingeSection isHome /> })
    await waitFor(() => expect(item).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('hides locked selections on home', async () => {
    mark(1)
    const client = createQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    item.mockRejectedValue(new ApiError({ status: 423, message: 'Locked' }))
    const view = renderWithProviders({ ui: <BingeSection isHome />, client })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByRole('region')).toBeNull()
    view.unmount()
    renderWithProviders({ ui: <BingePage />, client })
    expect(await screen.findByRole('alert')).toHaveTextContent(BINGE_COPY.unavailable)
  })

  it('offers retry and removal for an unavailable selection', async () => {
    mark(1)
    item.mockRejectedValue(new Error('Access denied'))
    renderWithProviders({ ui: <BingePage /> })
    expect(await screen.findByRole('alert')).toHaveTextContent(BINGE_COPY.unavailable)
    item.mockImplementation(async (id) =>
      itemDetails({ id, type: ITEM_TYPES.show, title: 'Available again' }),
    )
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.retry }))
    expect(await screen.findByRole('link', { name: /Available again/ })).toBeInTheDocument()
  })

  it('frees a slot when a deleted show is removed', async () => {
    mark(1)
    item.mockRejectedValue(new Error('Not found'))
    renderWithProviders({ ui: <BingePage /> })
    await userEvent.click(await screen.findByRole('button', { name: BINGE_COPY.remove }))
    expect(screen.getByRole('heading', { name: BINGE_COPY.emptyTitle })).toBeInTheDocument()
  })
})
