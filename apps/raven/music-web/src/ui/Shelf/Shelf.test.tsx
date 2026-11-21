import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { useCovers } from '@/music/useCovers'
import { OK_COMPUTER } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { Shelf } from '@/ui/Shelf/Shelf'

describe('Shelf', () => {
  it('sets albums on a shelf, each a tile', () => {
    const onOpen = mock()
    renderKitWithRoutes(
      <Shelf
        albums={[OK_COMPUTER, { ...OK_COMPUTER, id: 8, title: 'Kid A' }]}
        coverOf={useCovers().coverOf}
        onOpen={onOpen}
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Kid A')).toBeInTheDocument()
  })
})
