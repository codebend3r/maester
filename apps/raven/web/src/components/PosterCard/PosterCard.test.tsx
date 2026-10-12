import { describe, expect, it } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const picture = (container: HTMLElement): HTMLImageElement | null => container.querySelector('img')

describe('PosterCard', () => {
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
