import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { mediaItem } from '@/test/fixtures'
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
})
