import { describe, expect, it } from 'bun:test'
import { useCovers } from '@/music/useCovers'
import { AIRBAG, COVER_VERSION, OK_COMPUTER, RADIOHEAD } from '@/test/music'

describe('useCovers', () => {
  const { coverOf, trackCoverOf, artistPhotoOf } = useCovers()

  it("hands out an album's cover as an address on the page's own origin", () => {
    const cover = coverOf({ albumId: OK_COMPUTER.id, coverVersion: COVER_VERSION })

    expect(cover?.src ?? '').toStartWith('/api/')
    expect(cover?.src ?? '').toContain(COVER_VERSION)
  })

  it('has none for an album without a cover', () => {
    expect(coverOf({ albumId: OK_COMPUTER.id, coverVersion: null })).toBeNull()
  })

  it("reads a track's cover off its album", () => {
    const track = { ...AIRBAG, album: { ...AIRBAG.album, coverVersion: COVER_VERSION } }

    expect(trackCoverOf(track)).toEqual(
      coverOf({ albumId: AIRBAG.albumId, coverVersion: COVER_VERSION }),
    )
    expect(trackCoverOf(AIRBAG)).toBeNull()
  })

  it("hands out an artist's photo once the server has one", () => {
    expect(artistPhotoOf(RADIOHEAD)).toBeNull()
    expect(artistPhotoOf({ id: RADIOHEAD.id, photoVersion: 'photo-v1' })?.src ?? '').toStartWith(
      '/api/',
    )
  })
})
