import { describe, expect, it } from 'bun:test'
import { describeLayout, groupFolderOf, isLetterFolder } from '@/folderLayout'

describe('isLetterFolder', () => {
  it.each(['A', 'z', '#', '0-9', 'A-C', 'a - c'])('reads %s as a letter folder', (name) => {
    expect(isLetterFolder(name)).toBe(true)
  })

  it.each(['AB', 'Andor', 'Requests', '1', 'A-', 'Season 1', ''])('reads %s as a name', (name) => {
    expect(isLetterFolder(name)).toBe(false)
  })
})

describe('groupFolderOf', () => {
  const shows = (folder: string) => groupFolderOf({ kind: 'animeShows', folder, layout: 'auto' })
  const movies = (folder: string) => groupFolderOf({ kind: 'movies', folder, layout: 'auto' })

  it('reads a letter folder of shows as a container', () => {
    expect(shows('A/Andor/Season 1')).toBe('A')
    expect(shows('#/13 Reasons Why/Season 1')).toBe('#')
    expect(shows('A-C/Andor/Season 1')).toBe('A-C')
  })

  it('keeps a show named with one letter, whose season folders sit right under it', () => {
    expect(shows('K/Season 1')).toBeNull()
    expect(shows('K/Specials')).toBeNull()
    expect(shows('K/K/Season 1')).toBe('K')
  })

  it('reads a loose episode in a letter folder from its own name', () => {
    expect(shows('A')).toBe('A')
  })

  it('reads a folder of shows, each with seasons, as a container', () => {
    expect(shows('Requests/Cupertino/Season 1')).toBe('Requests')
    expect(shows('Star Trek/Star Trek - The Next Generation/Season 1')).toBe('Star Trek')
  })

  it('keeps an ordinary show folder, with or without season folders', () => {
    expect(shows('Andor/Season 1')).toBeNull()
    expect(shows('Fargo')).toBeNull()
    expect(shows('Severance (2022)/Featurettes')).toBeNull()
    expect(shows('')).toBeNull()
  })

  it('reads a letter folder of movies as a container, loose movies included', () => {
    expect(movies('A/Alien (1979)')).toBe('A')
    expect(movies('H')).toBe('H')
    expect(movies('#/2001 A Space Odyssey (1968)')).toBe('#')
  })

  it('reads a folder with no year that holds movie folders with years as a container', () => {
    expect(movies('Requests/25th Hour (2002)')).toBe('Requests')
    expect(movies('_Trash_Review/Horizon (2024)')).toBe('_Trash_Review')
  })

  it('keeps a movie folder and its extras', () => {
    expect(movies('Alien (1979)')).toBeNull()
    expect(movies('Alien (1979)/Featurettes')).toBeNull()
    expect(movies('S/Season of the Witch (2011)')).toBe('S')
    expect(movies('_Trash_Review')).toBeNull()
  })

  it('reads nothing as a container in a flat layout, or in a library that is never matched', () => {
    expect(groupFolderOf({ kind: 'shows', folder: 'A/Andor/Season 1', layout: 'flat' })).toBeNull()
    expect(groupFolderOf({ kind: 'other', folder: 'A/Clip', layout: 'auto' })).toBeNull()
    expect(
      groupFolderOf({ kind: 'youtube', folder: 'Requests/Lofi Girl (2024)', layout: 'auto' }),
    ).toBeNull()
  })

  it('reads group folders in a Sporting events library, as it is matched like movies', () => {
    expect(
      groupFolderOf({ kind: 'sports', folder: 'Requests/UFC 300 (2024)', layout: 'auto' }),
    ).toBe('Requests')
  })
})

describe('describeLayout', () => {
  it('names a path by its group folders', () => {
    expect(describeLayout([])).toBe('flat')
    expect(describeLayout(['A', 'B', 'A', 'Requests'])).toBe('lettered')
    expect(describeLayout(['Requests', 'Star Trek', 'A'])).toBe('grouped')
  })
})
