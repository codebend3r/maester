import { describe, expect, it, mock } from 'bun:test'
import { artistNames } from '@raven/core'
import { KIT_COPY, countsLineOf } from '@raven/wren'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCovers } from '@/music/useCovers'
import { albumPath } from '@/routes'
import { MIXTAPE, OK_COMPUTER } from '@/test/music'
import { KIT_PAGES, renderKitWithRoutes } from '@/test/render'
import { AlbumTile, AlbumTileOf } from '@/ui/AlbumTile/AlbumTile'

const ALBUM_LABEL = KIT_COPY.labelled({ label: OK_COMPUTER.title, value: artistNames(OK_COMPUTER) })

describe('AlbumTile', () => {
  it('opens an album from its tile, as a link named by its title and artists', async () => {
    renderKitWithRoutes(<AlbumTileOf album={OK_COMPUTER} coverOf={useCovers().coverOf} />)
    const tile = screen.getByRole('link', { name: ALBUM_LABEL })

    expect(tile).toHaveAttribute('href', albumPath(OK_COMPUTER.id))
    expect(within(tile).getByText(artistNames(OK_COMPUTER))).toBeInTheDocument()
    await userEvent.click(tile)

    expect(screen.getByText(KIT_PAGES.album)).toBeInTheDocument()
  })

  it('stays a link to the album and tells the place on the way, when the place does more than open it', async () => {
    const onPress = mock()
    renderKitWithRoutes(
      <AlbumTileOf
        album={OK_COMPUTER}
        coverOf={useCovers().coverOf}
        onPress={onPress}
        subtitle="1997"
      />,
    )

    expect(screen.getByText('1997')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: ALBUM_LABEL }))

    expect(onPress).toHaveBeenCalledWith(OK_COMPUTER)
    expect(screen.getByText(KIT_PAGES.album)).toBeInTheDocument()
  })

  it('draws a playlist as a tile that does what a press asks', async () => {
    const onPress = mock()
    renderKitWithRoutes(
      <AlbumTile
        cover={null}
        label={MIXTAPE.name}
        onPress={onPress}
        subtitle={countsLineOf({ songs: MIXTAPE.trackCount })}
        title={MIXTAPE.name}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: MIXTAPE.name }))

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 songs')).toBeInTheDocument()
  })
})
