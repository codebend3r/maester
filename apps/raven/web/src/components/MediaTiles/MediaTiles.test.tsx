import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { POSTER_SIZES } from '@/lib/posters'
import { matchedMovie, mediaItem } from '@/test/fixtures'
import { atPixelRatio, restorePixelRatio } from '@/test/pixelRatio'
import { renderWithProviders } from '@/test/render'
import { reported } from '@/test/viewport'

describe('MediaTiles', () => {
  afterEach(restorePixelRatio)

  it('shows each video with its facts and the folder it sits in', () => {
    renderWithProviders({ ui: <MediaTiles items={[mediaItem({ folder: 'Comedy/2026' })]} /> })
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

  it("gives a Movies library's tile a poster no wider than its small column needs", async () => {
    const { container } = renderWithProviders({
      ui: <MediaTiles items={[matchedMovie()]} posters />,
    })
    await reported()
    const poster = container.querySelector('img')
    expect(poster).toHaveAttribute('src', '/api/items/40/images/poster?v=p1')
    expect(poster?.getAttribute('srcset')).toContain('/api/items/40/images/poster?v=p1&w=185 185w')
    expect(poster).toHaveAttribute('sizes', POSTER_SIZES.movieTile)
  })

  it('keeps the widths at 3x, where a tile poster 56 px wide needs no more than 185', () => {
    atPixelRatio(3)
    const { container } = renderWithProviders({
      ui: <MediaTiles items={[matchedMovie()]} posters />,
    })
    expect(container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.movieTile)
  })

  it('shows the check for a watched video and not for another', () => {
    renderWithProviders({ ui: <MediaTiles items={[mediaItem({ watched: true })]} /> })
    expect(screen.getByText('Watched')).toBeInTheDocument()
    cleanup()
    renderWithProviders({ ui: <MediaTiles items={[mediaItem()]} /> })
    expect(screen.queryByText('Watched')).toBeNull()
  })

  it('shows the check with the resume bar for a rewatch, on a poster tile too', () => {
    const rewatch = matchedMovie({ watched: true, position: 30, duration: 120 })
    const { container } = renderWithProviders({ ui: <MediaTiles items={[rewatch]} posters /> })
    expect(screen.getByText('Watched')).toBeInTheDocument()
    expect(container.querySelector('[style]')).toHaveStyle({ width: '25%' })
  })

  it('leaves the check off the history, whose notes say what was watched', () => {
    renderWithProviders({
      ui: (
        <MediaTiles
          items={[mediaItem({ watched: true })]}
          note={() => '100% watched'}
          withWatched={false}
        />
      ),
    })
    expect(screen.queryByText('Watched')).toBeNull()
  })
})
