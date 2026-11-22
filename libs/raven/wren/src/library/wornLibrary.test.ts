import { describe, expect, it } from 'bun:test'
import { isLibraryPick, wornLibrariesOf } from '@/library/wornLibrary'

const MUSIC = { id: 5, name: 'Music' }
const SOUNDTRACKS = { id: 9, name: 'Soundtracks' }
const LIBRARIES = [MUSIC, SOUNDTRACKS]

describe('wornLibrariesOf', () => {
  it("wears the server's first library until one is picked", () => {
    expect(wornLibrariesOf({ libraries: LIBRARIES, libraryId: null })).toEqual([MUSIC])
  })

  it('wears the library picked', () => {
    expect(wornLibrariesOf({ libraries: LIBRARIES, libraryId: SOUNDTRACKS.id })).toEqual([
      SOUNDTRACKS,
    ])
  })

  it('falls back to the first when the server no longer has the one picked', () => {
    expect(wornLibrariesOf({ libraries: LIBRARIES, libraryId: 404 })).toEqual([MUSIC])
  })

  it('wears none when the server has no music library', () => {
    expect(wornLibrariesOf({ libraries: [], libraryId: MUSIC.id })).toEqual([])
  })
})

describe('isLibraryPick', () => {
  it('is an id or none', () => {
    expect(isLibraryPick(5)).toBe(true)
    expect(isLibraryPick(null)).toBe(true)
    expect(isLibraryPick('5')).toBe(false)
  })
})
