import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ShowCard, ShowGrid, ShowGridSkeleton } from '@/components/ShowCard/ShowCard'
import { ShowList, ShowTiles } from '@/components/ShowCard/ShowViews'
import { POSTER_SIZES } from '@/lib/posters'
import { showEntry } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { usePageBackdrop } from '@raven/ui/headless'
import { reported } from '@/test/viewport'

describe('ShowCard', () => {
  afterEach(() => {
    usePageBackdrop.setState({ current: null, shown: null, recent: [], loaded: [] })
  })

  it("lays its show's backdrop behind the page while pointed at", async () => {
    const entry = showEntry()
    const { container } = renderWithProviders({
      ui: (
        <ul>
          <ShowCard
            sizes={POSTER_SIZES.row}
            entry={{ ...entry, show: { ...entry.show, backdropVersion: 'b9' } }}
          />
        </ul>
      ),
    })
    fireEvent.pointerEnter(container.querySelector('li') ?? document.body, {
      pointerType: 'mouse',
    })
    await waitFor(() =>
      expect(usePageBackdrop.getState().current).toBe('/api/items/4/images/backdrop?v=b9'),
    )
  })

  it('says when its newest episode came when shows are sorted by when they were added', () => {
    const addedAt = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry({ addedAt })} sort="added" />
        </ul>
      ),
    })
    expect(screen.getByText('Added 3 days ago')).toBeInTheDocument()
  })

  it("opens the show's page, plays the next episode, and says the years and count", async () => {
    const { container } = renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry()} />
        </ul>
      ),
    })
    await reported()
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

  it('offers its poster at each width, sized as the row or grid holding it lays it out', async () => {
    const srcset = [
      '/api/items/4/images/poster?v=p1&w=185 185w',
      '/api/items/4/images/poster?v=p1&w=342 342w',
      '/api/items/4/images/poster?v=p1 500w',
    ].join(', ')
    const row = renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry()} />
        </ul>
      ),
    })
    await reported()
    expect(row.container.querySelector('img')).toHaveAttribute('srcset', srcset)
    expect(row.container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.row)
    const grid = renderWithProviders({ ui: <ShowGrid shows={[showEntry()]} /> })
    await reported()
    expect(grid.container.querySelector('img')).toHaveAttribute('srcset', srcset)
    expect(grid.container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.showCard)
    const tiles = renderWithProviders({ ui: <ShowTiles shows={[showEntry()]} /> })
    await reported()
    expect(tiles.container.querySelector('img')).toHaveAttribute('srcset', srcset)
    expect(tiles.container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.showTile)
  })

  it("shows a tile's scores as the ratings panel does, each in a badge", () => {
    renderWithProviders({ ui: <ShowTiles shows={[showEntry()]} /> })
    const ratings = screen.getByRole('list', { name: 'Ratings' })
    expect(within(ratings).getByText('TMDB: 8.2 out of 10')).toBeInTheDocument()
    expect(within(ratings).getByText('/10')).toBeInTheDocument()
  })

  it('gives an ended show both years, and no play button once every episode is watched', () => {
    renderWithProviders({
      ui: (
        <ShowGrid
          shows={[
            showEntry({
              show: { ...showEntry().show, year: 2014 },
              endedYear: 2024,
              episodes: 1,
              next: null,
            }),
          ]}
        />
      ),
    })
    expect(screen.getByText('2014 to 2024')).toBeInTheDocument()
    expect(screen.getByText('1 episode')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Play/ })).toBeNull()
  })

  it('shows the number unwatched, with its words, when some episodes are', () => {
    renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry({ watchedEpisodes: 3 })} />
        </ul>
      ),
    })
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('6 unwatched episodes')).toBeInTheDocument()
  })

  it('shows the check when every episode is watched', () => {
    renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry({ watchedEpisodes: 9 })} />
        </ul>
      ),
    })
    expect(screen.getByText('Watched')).toBeInTheDocument()
  })

  it('shows nothing when none is watched', () => {
    renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry()} />
        </ul>
      ),
    })
    expect(screen.queryByText(/unwatched/)).toBeNull()
    expect(screen.queryByText('Watched')).toBeNull()
  })

  it('names the next episode on the wide card, and plays it from there', () => {
    renderWithProviders({ ui: <ShowGrid shows={[showEntry()]} /> })
    const play = screen.getByRole('link', { name: 'Play Severance S01E02' })
    expect(play).toHaveAttribute('href', '/watch/12')
    expect(play).toHaveTextContent('S01E02 · Half Loop')
    expect(screen.getByRole('link', { name: 'Severance' })).toHaveAttribute('href', '/shows/4')
  })

  it('says every episode is watched on the wide card once none is left', () => {
    renderWithProviders({
      ui: <ShowGrid shows={[showEntry({ watchedEpisodes: 9, next: null })]} />,
    })
    expect(screen.getByText('All watched')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Play/ })).toBeNull()
  })

  it('shows the number unwatched on the wide card, and nothing for a show not started', () => {
    renderWithProviders({ ui: <ShowGrid shows={[showEntry({ watchedEpisodes: 3 })]} /> })
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('6 unwatched episodes')).toBeInTheDocument()
    cleanup()
    renderWithProviders({ ui: <ShowGrid shows={[showEntry()]} /> })
    expect(screen.queryByText(/unwatched/)).toBeNull()
    expect(screen.queryByText('All watched')).toBeNull()
  })

  it("washes the wide card in its poster, fetched at the poster's own width", () => {
    const { container } = renderWithProviders({ ui: <ShowGrid shows={[showEntry()]} /> })
    const [poster, wash] = [...container.querySelectorAll('img')]
    expect(wash).toHaveAttribute('alt', '')
    expect(wash?.getAttribute('srcset')).toBe(poster?.getAttribute('srcset'))
    expect(wash?.getAttribute('sizes')).toBe(poster?.getAttribute('sizes'))
  })

  it('falls back to the initial when the poster fails to load', () => {
    const { container } = renderWithProviders({
      ui: (
        <ul>
          <ShowCard sizes={POSTER_SIZES.row} entry={showEntry()} />
        </ul>
      ),
    })
    fireEvent.error(container.querySelector('img') ?? document.body)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a[aria-hidden="true"]')).toHaveTextContent('S')
  })

  it('stands in for the wide cards while they load', () => {
    const { container } = renderWithProviders({ ui: <ShowGridSkeleton count={3} /> })
    expect(container.querySelectorAll('li')).toHaveLength(3)
  })

  it('gives each list row a small poster out of the tab order', () => {
    const { container } = renderWithProviders({ ui: <ShowList shows={[showEntry()]} /> })
    const poster = container.querySelector('tbody img')
    expect(poster).toHaveAttribute('sizes', POSTER_SIZES.list)
    expect(poster?.closest('a')).toHaveAttribute('tabindex', '-1')
  })

  it('shows the count in a list row and in a tile', () => {
    renderWithProviders({ ui: <ShowList shows={[showEntry({ watchedEpisodes: 3 })]} /> })
    const [, row] = screen.getAllByRole('row')
    if (!row) throw new Error('no data row')
    expect(row).toHaveTextContent('6 unwatched episodes')
    cleanup()
    renderWithProviders({ ui: <ShowTiles shows={[showEntry({ watchedEpisodes: 9 })]} /> })
    expect(screen.getByText('Watched')).toBeInTheDocument()
  })

  it('shows nothing in a list row or a tile when none is watched', () => {
    const { container } = renderWithProviders({
      ui: (
        <>
          <ShowList shows={[showEntry()]} />
          <ShowTiles shows={[showEntry()]} />
        </>
      ),
    })
    expect(container).not.toHaveTextContent('unwatched')
    expect(container).not.toHaveTextContent('Watched')
  })
})
