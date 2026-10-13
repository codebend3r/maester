import { describe, expect, it } from 'bun:test'
import { LIBRARY_ICON_NAMES, LIBRARY_KINDS } from '@raven/core'
import { libraryIconOf, pickedIcon } from '@/lib/libraryKinds'

describe('libraryIconOf', () => {
  it("wears the icon a library picked, else its type's", () => {
    expect(libraryIconOf({ kind: 'sports', icon: 'octagon' })).toBe('octagon')
    expect(libraryIconOf({ kind: 'sports', icon: null })).toBe('trophy')
  })
})

describe('pickedIcon', () => {
  it("keeps the type's own icon as none picked, and any other as picked", () => {
    expect(pickedIcon({ kind: 'sports', icon: 'trophy' })).toBeNull()
    expect(pickedIcon({ kind: 'sports', icon: 'octagon' })).toBe('octagon')
    expect(pickedIcon({ kind: 'movies', icon: 'trophy' })).toBe('trophy')
  })

  it('undoes libraryIconOf for every icon a library of any type can pick', () => {
    const roundTrips = LIBRARY_KINDS.flatMap((kind) =>
      LIBRARY_ICON_NAMES.map(
        (icon) => libraryIconOf({ kind, icon: pickedIcon({ kind, icon }) }) === icon,
      ),
    )
    expect(roundTrips.every(Boolean)).toBe(true)
  })
})
