import { describe, expect, it } from 'bun:test'
import { fireEvent } from '@testing-library/react'
import { useCovers } from '@/music/useCovers'
import { COVER_VERSION, OK_COMPUTER } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'

const COVERED = { ...OK_COMPUTER, coverVersion: COVER_VERSION }

describe('AlbumArt', () => {
  it("draws the server's cover, and none for an album without one", () => {
    const { coverOf } = useCovers()
    const cover = coverOf({ albumId: COVERED.id, coverVersion: COVERED.coverVersion })
    const { container } = renderKitWithRoutes(
      <>
        <AlbumArt cover={cover} size={SIZES.rowArt} />
        <AlbumArt cover={coverOf({ albumId: OK_COMPUTER.id, coverVersion: null })} />
      </>,
    )

    const pictures = container.querySelectorAll('img')
    expect(pictures).toHaveLength(1)
    expect(pictures[0]).toHaveAttribute('src', cover?.src ?? '')
    expect(cover?.src ?? '').toStartWith('/api/')
  })

  it('falls back to the note when a cover will not load', () => {
    const { container } = renderKitWithRoutes(<AlbumArt cover={{ src: '/api/pictures/gone' }} />)

    fireEvent.error(container.querySelector('img')!)

    expect(container.querySelector('img')).toBeNull()
  })
})
