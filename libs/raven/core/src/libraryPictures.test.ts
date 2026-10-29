import { describe, expect, it } from 'bun:test'
import { picturesIn } from '@/libraryPictures'
import { itemDetails } from '@/test/fixtures'

describe('picturesIn', () => {
  const details = itemDetails({
    posterVersion: 'own',
    backdropVersion: 'own-backdrop',
    logoVersion: null,
    libraryPictures: [
      { libraryId: 2, posterVersion: 'uhd', backdropVersion: 'uhd-backdrop', logoVersion: 'logo' },
    ],
  })

  it('shows the pictures the library chose', () => {
    expect(picturesIn({ details, libraryId: 2 })).toMatchObject({
      posterVersion: 'uhd',
      backdropVersion: 'uhd-backdrop',
      logoVersion: 'logo',
    })
  })

  it('keeps its own pictures for no library, or one with none listed', () => {
    expect(picturesIn({ details, libraryId: null })).toBe(details)
    expect(picturesIn({ details, libraryId: 5 })).toBe(details)
    expect(
      picturesIn({ details: itemDetails({ libraryPictures: undefined }), libraryId: 2 }),
    ).toEqual(itemDetails({ libraryPictures: undefined }))
  })
})
