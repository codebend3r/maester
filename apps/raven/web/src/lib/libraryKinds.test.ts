import { describe, expect, it } from 'bun:test'
import { libraryIconOf } from '@/lib/libraryKinds'

describe('libraryIconOf', () => {
  it("wears the icon a library picked, the type's own included, else its type's", () => {
    expect(libraryIconOf({ kind: 'sports', icon: 'octagon' })).toBe('octagon')
    expect(libraryIconOf({ kind: 'movies', icon: 'trophy' })).toBe('trophy')
    expect(libraryIconOf({ kind: 'sports', icon: null })).toBe('trophy')
    expect(libraryIconOf({ kind: 'movies', icon: null })).toBe('film')
  })
})
