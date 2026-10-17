import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { PosterOverlay } from '@/components/PosterOverlay/PosterOverlay'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('PosterOverlay', () => {
  it("names the video's resolution and links to play it", () => {
    renderWithProviders({
      ui: <PosterOverlay media={mediaItem()} play={{ to: '/watch/7', label: 'Play Busboys' }} />,
    })
    expect(screen.getByLabelText('Video resolution: 1080p')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Play Busboys' })).toHaveAttribute('href', '/watch/7')
  })

  it('has no play button for a card with nothing to play', () => {
    renderWithProviders({ ui: <PosterOverlay media={mediaItem()} play={null} /> })
    expect(screen.getByLabelText('Video resolution: 1080p')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
