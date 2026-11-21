import { describe, expect, it } from 'bun:test'
import { artistNames } from '@raven/core'
import { KIT_COPY } from '@raven/wren'
import { screen, within } from '@testing-library/react'
import { useCovers } from '@/music/useCovers'
import { OK_COMPUTER } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { AlbumTileOf } from '@/ui/AlbumTile/AlbumTile'
import { GRID_COLUMNS, TileGrid } from '@/ui/TileGrid/TileGrid'

const ALBUM_LABEL = KIT_COPY.labelled({ label: OK_COMPUTER.title, value: artistNames(OK_COMPUTER) })

describe('TileGrid', () => {
  it('lays tiles out in a grid, two to a row on the narrow layout and five on the wide', () => {
    renderKitWithRoutes(
      <TileGrid
        items={[OK_COMPUTER]}
        keyOf={(album) => album.id}
        renderTile={({ item }) => <AlbumTileOf album={item} coverOf={useCovers().coverOf} />}
      />,
    )

    expect(GRID_COLUMNS).toEqual({ phone: 2, tablet: 5 })
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('link', { name: ALBUM_LABEL })).toBeInTheDocument()
  })
})
