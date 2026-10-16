import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ShowCard, ShowGrid } from '@/components/ShowCard/ShowCard'
import { ShowTiles } from '@/components/ShowCard/ShowViews'
import { POSTER_SIZES } from '@/lib/posters'
import { showEntry } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { usePageBackdrop } from '@/stores/pageBackdrop'

describe('ShowCard', () => {
  afterEach(() => {
    usePageBackdrop.setState({ current: null, shown: null, recent: [], loaded: [] })
  })

  it("lays its show's backdrop behind the page while pointed at", async () => {
    const entry = showEntry()
    const { container } = renderWithProviders(
      <ul>
        <ShowCard
          sizes={POSTER_SIZES.row}
          entry={{ ...entry, show: { ...entry.show, backdropVersion: 'b9' } }}
        />
      </ul>,
    )
    fireEvent.pointerEnter(container.querySelector('li') ?? document.body, {
      pointerType: 'mouse',
    })
    await waitFor(() =>
      expect(usePageBackdrop.getState().current).toBe('/api/items/4/images/backdrop?v=b9'),
    )
  })

  it('says when its newest episode came when shows are sorted by when they were added', () => {
    const addedAt = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    renderWithProviders(
      <ul>
        <ShowCard sizes={POSTER_SIZES.row} entry={showEntry({ addedAt })} sort="added" />
      </ul>,
    )
    expect(screen.getByText('Added 3 days ago')).toBeInTheDocument()
  })

  it("opens the show's page, plays the next episode, and says the years and count", () => {
    const { container } = renderWithProviders(
      <ul>
        <ShowCard sizes={POSTER_SIZES.row} entry={showEntry()} />
      </ul>,
    )
    expect(screen.getByRole('link', { name: 'Severance' })).toHaveAttribute('href', '/shows/4')
    expect(screen.getByRole('link', { name: 'Play Severance S01E02' })).toHaveAttribute(
      'href',
      '/watch/12',
    )
    expect(screen.getByText('2022 to now')).toBeInTheDocument()
    expect(screen.getByText('9 episodes')).toBeInTheDocument()
    expect(screen.getByLabelText('Video resolution: 1080p')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/items/4/images/poster?v=p1')
  })

  it('offers its poster at each width, sized as the row or grid holding it lays it out', () => {
    const srcset = [
      '/api/items/4/images/poster?v=p1&w=185 185w',
      '/api/items/4/images/poster?v=p1&w=342 342w',
      '/api/items/4/images/poster?v=p1 500w',
    ].join(', ')
    const row = renderWithProviders(
      <ul>
        <ShowCard sizes={POSTER_SIZES.row} entry={showEntry()} />
      </ul>,
    )
    expect(row.container.querySelector('img')).toHaveAttribute('srcset', srcset)
    expect(row.container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.row)
    const grid = renderWithProviders(<ShowGrid shows={[showEntry()]} />)
    expect(grid.container.querySelector('img')).toHaveAttribute('srcset', srcset)
    expect(grid.container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.grid)
    const tiles = renderWithProviders(<ShowTiles shows={[showEntry()]} />)
    expect(tiles.container.querySelector('img')).toHaveAttribute('srcset', srcset)
    expect(tiles.container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.showTile)
  })

  it('gives an ended show both years, and no play button once every episode is watched', () => {
    renderWithProviders(
      <ShowGrid
        shows={[
          showEntry({
            show: { ...showEntry().show, year: 2014 },
            endedYear: 2024,
            episodes: 1,
            next: null,
          }),
        ]}
      />,
    )
    expect(screen.getByText('2014 to 2024')).toBeInTheDocument()
    expect(screen.getByText('1 episode')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Play/ })).toBeNull()
  })
})
