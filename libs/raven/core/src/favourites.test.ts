import { describe, expect, it } from 'bun:test'
import { canFavouriteIn } from '@/favourites'
import { library } from '@/test/fixtures'

describe('canFavouriteIn', () => {
  const open = library({ id: 1 })
  const locked = library({ id: 2, settings: { ...open.settings, locked: true } })

  it("refuses a locked library's videos, PIN or not", () => {
    expect(canFavouriteIn({ libraries: [open, locked], libraryId: 2 })).toBe(false)
    expect(canFavouriteIn({ libraries: [open, locked], libraryId: 1 })).toBe(true)
  })

  it('allows a library it does not know yet, as the server refuses a locked one anyway', () => {
    expect(canFavouriteIn({ libraries: [], libraryId: 2 })).toBe(true)
  })
})
