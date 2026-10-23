import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { POSTER_SIZES } from '@/lib/posters'
import { itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { usePageBackdrop } from '@raven/ui/headless'
import { atPixelRatio, restorePixelRatio } from '@/test/pixelRatio'
import { renderWithProviders } from '@/test/render'
import { reported } from '@/test/viewport'

const picture = (container: HTMLElement): HTMLImageElement | null => container.querySelector('img')

describe('PosterCard', () => {
  afterEach(() => {
    restorePixelRatio()
  })

  const shownBehind = () => usePageBackdrop.getState().current

  it("lays its movie's backdrop behind the page while pointed at, and puts it away after", async () => {
    const { container } = renderWithProviders({
      ui: (
        <PosterCard
          sizes={POSTER_SIZES.grid}
          media={matchedMovie({ item: itemSummary({ backdropVersion: 'b9' }) })}
        />
      ),
    })
    const card = container.querySelector('li') ?? document.body
    fireEvent.pointerEnter(card, { pointerType: 'mouse' })
    await waitFor(() => expect(shownBehind()).toBe('/api/items/40/images/backdrop?v=b9'))
    fireEvent.pointerLeave(card, { pointerType: 'mouse' })
    expect(shownBehind()).not.toBeNull()
    await waitFor(() => expect(shownBehind()).toBeNull())
  })

  it('shows the backdrop as soon as the card is focused', () => {
    renderWithProviders({
      ui: (
        <PosterCard
          sizes={POSTER_SIZES.grid}
          media={matchedMovie({ item: itemSummary({ backdropVersion: 'b9' }) })}
        />
      ),
    })
    fireEvent.focus(screen.getByRole('link', { name: 'Busboys' }))
    expect(shownBehind()).toBe('/api/items/40/images/backdrop?v=b9')
  })

  it('leaves the page alone for a touch, and for a movie with no backdrop', async () => {
    const { container } = renderWithProviders({
      ui: (
        <PosterCard
          sizes={POSTER_SIZES.grid}
          media={matchedMovie({ item: itemSummary({ backdropVersion: 'b9' }) })}
        />
      ),
    })
    fireEvent.pointerEnter(container.querySelector('li') ?? document.body, {
      pointerType: 'touch',
    })
    renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie({ id: 8 })} />,
    })
    fireEvent.focus(screen.getAllByRole('link', { name: 'Busboys' })[1] ?? document.body)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(shownBehind()).toBeNull()
  })

  it('shows the value its listing is sorted by', () => {
    renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie()} sort="bitrate-high" />,
    })
    expect(screen.getByText('2.2 Mb/s')).toBeInTheDocument()
  })

  it("opens a matched movie's page, plays from its button, and shows the year", () => {
    renderWithProviders({ ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie()} /> })
    expect(screen.getByRole('link', { name: 'Busboys' })).toHaveAttribute(
      'href',
      '/movies/40?library=2',
    )
    expect(screen.getByRole('link', { name: 'Play Busboys' })).toHaveAttribute('href', '/watch/7')
    expect(screen.getByLabelText('Video resolution: 1080p')).toBeInTheDocument()
    expect(screen.getByText('2026')).toBeInTheDocument()
  })

  it('offers its poster at each width, so the browser fetches the narrowest its grid needs', async () => {
    const { container } = renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie()} />,
    })
    await reported()
    expect(picture(container)).toHaveAttribute(
      'srcset',
      [
        '/api/items/40/images/poster?v=p1&w=185 185w',
        '/api/items/40/images/poster?v=p1&w=342 342w',
        '/api/items/40/images/poster?v=p1 500w',
      ].join(', '),
    )
    expect(picture(container)).toHaveAttribute('sizes', POSTER_SIZES.grid)
  })

  // A grid poster is at least 128 px wide, so 342 px covers it up to 342 / 128 = 2.67x.
  it('leaves the widths out on a screen dense enough to need the widest anyway', async () => {
    const at = async (ratio: number) => {
      atPixelRatio(ratio)
      const { container } = renderWithProviders({
        ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie()} />,
      })
      await reported()
      return picture(container)
    }
    expect(await at(2.6)).toHaveAttribute('sizes', POSTER_SIZES.grid)
    const dense = [await at(2.75), await at(3)]
    expect(dense.map((poster) => poster?.getAttribute('src'))).toEqual([
      '/api/items/40/images/poster?v=p1',
      '/api/items/40/images/poster?v=p1',
    ])
    expect(dense.map((poster) => poster?.hasAttribute('srcset') ?? true)).toEqual([false, false])
    expect(dense.map((poster) => poster?.hasAttribute('sizes') ?? true)).toEqual([false, false])
  })

  it('falls back from the poster to the frame grab, then to a letter', async () => {
    const { container } = renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie()} />,
    })
    await reported()
    expect(picture(container)).toHaveAttribute('src', '/api/items/40/images/poster?v=p1')
    fireEvent.error(picture(container) ?? document.body)
    await reported()
    expect(picture(container)).toHaveAttribute('src', '/api/media/7/thumbnail?v=1')
    expect(picture(container)).not.toHaveAttribute('srcset')
    expect(picture(container)).not.toHaveAttribute('sizes')
    fireEvent.error(picture(container) ?? document.body)
    expect(picture(container)).toBeNull()
    expect(container.textContent).toContain('B')
  })

  it('uses the frame grab straight away when there is no poster', async () => {
    const { container } = renderWithProviders({
      ui: (
        <PosterCard
          sizes={POSTER_SIZES.grid}
          media={matchedMovie({ item: itemSummary({ posterVersion: null }) })}
        />
      ),
    })
    await reported()
    expect(picture(container)).toHaveAttribute('src', '/api/media/7/thumbnail?v=1')
  })

  it('says how many versions there are', () => {
    renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie({ versions: 2 })} />,
    })
    expect(screen.getByText('2 versions')).toBeInTheDocument()
  })

  it('opens the player for an unmatched file and says it is not matched', () => {
    renderWithProviders({
      ui: (
        <PosterCard
          sizes={POSTER_SIZES.grid}
          media={mediaItem({ title: 'Home Movie', year: 2019, match: 'unmatched' })}
        />
      ),
    })
    expect(screen.getByRole('link', { name: 'Home Movie' })).toHaveAttribute('href', '/watch/7')
    expect(screen.queryByRole('link', { name: /^Play/ })).toBeNull()
    expect(screen.getByText('Not matched')).toBeInTheDocument()
  })

  it('shows the check for a watched video and not for another', () => {
    renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie({ watched: true })} />,
    })
    expect(screen.getByText('Watched')).toBeInTheDocument()
    cleanup()
    renderWithProviders({ ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie()} /> })
    expect(screen.queryByText('Watched')).toBeNull()
  })

  it('draws the heart over the poster and says Favourite once, beside its facts', () => {
    const { container } = renderWithProviders({
      ui: <PosterCard sizes={POSTER_SIZES.grid} media={matchedMovie({ favourite: true })} />,
    })
    expect(screen.getAllByText('Favourite')).toHaveLength(1)
    const poster = container.querySelector('a[aria-hidden="true"]')
    expect(poster?.querySelector('svg')).not.toBeNull()
  })

  it('shows the check with the resume bar for a rewatch', () => {
    const { container } = renderWithProviders({
      ui: (
        <PosterCard
          sizes={POSTER_SIZES.grid}
          media={matchedMovie({ watched: true, position: 30, duration: 120 })}
        />
      ),
    })
    expect(screen.getByText('Watched')).toBeInTheDocument()
    expect(container.querySelector('[style]')).toHaveStyle({ width: '25%' })
  })
})
