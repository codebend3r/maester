import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { artistPath } from '@/routes'
import { RADIOHEAD } from '@/test/music'
import { KIT_PAGES, renderKitWithRoutes } from '@/test/render'
import { ArtistRow } from '@/ui/ArtistRow/ArtistRow'

describe('ArtistRow', () => {
  it('lists an artist with what they hold, the zeros left out, and opens their page', async () => {
    renderKitWithRoutes(
      <ArtistRow
        albumCount={RADIOHEAD.albumCount}
        href={artistPath(RADIOHEAD.id)}
        name={RADIOHEAD.name}
        picture={null}
        trackCount={0}
      />,
    )

    expect(screen.getByText('1 album')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: RADIOHEAD.name }))

    expect(screen.getByText(KIT_PAGES.artist)).toBeInTheDocument()
  })
})
