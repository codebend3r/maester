import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderKitWithRoutes } from '@/test/render'
import { ArtistAvatar } from '@/ui/ArtistAvatar/ArtistAvatar'

describe('ArtistAvatar', () => {
  it("shows an artist's initial until the server has their picture, hidden from a screen reader", () => {
    const { container } = renderKitWithRoutes(<ArtistAvatar name="radiohead" picture={null} />)

    expect(screen.getByText('R')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toContainElement(screen.getByText('R'))
  })
})
