import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { POSTER_SIZES } from '@/lib/posters'
import { matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('MediaTiles', () => {
  it('shows each video with its facts and the folder it sits in', () => {
    renderWithProviders(<MediaTiles items={[mediaItem({ folder: 'Comedy/2026' })]} />)
    const tile = screen.getByRole('listitem')
    expect(within(tile).getByRole('link', { name: 'Busboys (2026)' })).toHaveAttribute(
      'href',
      '/watch/7',
    )
    expect(tile).toHaveTextContent('1h 37m')
    expect(tile).toHaveTextContent('1080p')
    expect(tile).toHaveTextContent('HEVC')
    expect(tile).toHaveTextContent('1.6 GB')
    expect(tile).toHaveTextContent('Comedy/2026')
  })

  it("gives a Movies library's tile a poster no wider than its small column needs", () => {
    const { container } = renderWithProviders(<MediaTiles items={[matchedMovie()]} posters />)
    const poster = container.querySelector('img')
    expect(poster).toHaveAttribute('src', '/api/items/40/images/poster?v=p1')
    expect(poster?.getAttribute('srcset')).toContain('/api/items/40/images/poster?v=p1&w=185 185w')
    expect(poster).toHaveAttribute('sizes', POSTER_SIZES.movieTile)
  })

  it('keeps the widths at 3x, where a tile poster 56 px wide needs no more than 185', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    const { container } = renderWithProviders(<MediaTiles items={[matchedMovie()]} posters />)
    expect(container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.movieTile)
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  })
})
