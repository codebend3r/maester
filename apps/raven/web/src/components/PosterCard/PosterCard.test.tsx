import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { renderWithProviders } from '@/test/render'

const picture = (container: HTMLElement): HTMLImageElement | null => container.querySelector('img')

describe('PosterCard', () => {
  afterEach(() => usePageBackdrop.setState({ current: null, shown: null, recent: [], loaded: [] }))

  const shownBehind = () => usePageBackdrop.getState().current

  it("lays its movie's backdrop behind the page while pointed at, and puts it away after", async () => {
    const { container } = renderWithProviders(
      <PosterCard media={matchedMovie({ item: itemSummary({ backdropVersion: 'b9' }) })} />,
    )
    const card = container.querySelector('li') ?? document.body
    fireEvent.pointerEnter(card, { pointerType: 'mouse' })
    await waitFor(() => expect(shownBehind()).toBe('/api/items/40/images/backdrop?v=b9'))
    fireEvent.pointerLeave(card, { pointerType: 'mouse' })
    expect(shownBehind()).not.toBeNull()
    await waitFor(() => expect(shownBehind()).toBeNull())
  })

  it('shows the backdrop as soon as the card is focused', () => {
    renderWithProviders(
      <PosterCard media={matchedMovie({ item: itemSummary({ backdropVersion: 'b9' }) })} />,
    )
    fireEvent.focus(screen.getByRole('link', { name: 'Busboys' }))
    expect(shownBehind()).toBe('/api/items/40/images/backdrop?v=b9')
  })

  it('leaves the page alone for a touch, and for a movie with no backdrop', async () => {
    const { container } = renderWithProviders(
      <PosterCard media={matchedMovie({ item: itemSummary({ backdropVersion: 'b9' }) })} />,
    )
    fireEvent.pointerEnter(container.querySelector('li') ?? document.body, {
      pointerType: 'touch',
    })
    renderWithProviders(<PosterCard media={matchedMovie({ id: 8 })} />)
    fireEvent.focus(screen.getAllByRole('link', { name: 'Busboys' })[1] ?? document.body)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(shownBehind()).toBeNull()
  })

  it('shows the value its listing is sorted by', () => {
    renderWithProviders(<PosterCard media={matchedMovie()} sort="bitrate-high" />)
    expect(screen.getByText('2.2 Mb/s')).toBeInTheDocument()
  })

  it("opens a matched movie's page, plays from its button, and shows the year", () => {
    renderWithProviders(<PosterCard media={matchedMovie()} />)
    expect(screen.getByRole('link', { name: 'Busboys' })).toHaveAttribute('href', '/movies/40')
    expect(screen.getByRole('link', { name: 'Play Busboys' })).toHaveAttribute('href', '/watch/7')
    expect(screen.getByText('2026')).toBeInTheDocument()
  })

  it('falls back from the poster to the frame grab, then to a letter', () => {
    const { container } = renderWithProviders(<PosterCard media={matchedMovie()} />)
    expect(picture(container)).toHaveAttribute('src', '/api/items/40/images/poster?v=p1')
    fireEvent.error(picture(container) ?? document.body)
    expect(picture(container)).toHaveAttribute('src', '/api/media/7/thumbnail?v=1')
    fireEvent.error(picture(container) ?? document.body)
    expect(picture(container)).toBeNull()
    expect(container.textContent).toContain('B')
  })

  it('uses the frame grab straight away when there is no poster', () => {
    const { container } = renderWithProviders(
      <PosterCard media={matchedMovie({ item: itemSummary({ posterVersion: null }) })} />,
    )
    expect(picture(container)).toHaveAttribute('src', '/api/media/7/thumbnail?v=1')
  })

  it('says how many versions there are', () => {
    renderWithProviders(<PosterCard media={matchedMovie({ versions: 2 })} />)
    expect(screen.getByText('2 versions')).toBeInTheDocument()
  })

  it('opens the player for an unmatched file and says it is not matched', () => {
    renderWithProviders(
      <PosterCard media={mediaItem({ title: 'Home Movie', year: 2019, match: 'unmatched' })} />,
    )
    expect(screen.getByRole('link', { name: 'Home Movie' })).toHaveAttribute('href', '/watch/7')
    expect(screen.queryByRole('link', { name: /^Play/ })).toBeNull()
    expect(screen.getByText('Not matched')).toBeInTheDocument()
  })
})
