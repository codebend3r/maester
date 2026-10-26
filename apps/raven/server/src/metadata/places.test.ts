import { showFolderOf } from '@raven/core'
import { describe, expect, it } from 'vitest'
import {
  filePlace,
  groupPlaceOf,
  holdsOneMovie,
  rootOf,
  showDirOf,
  showPlace,
  stemOf,
} from '@/metadata/places'

type FileProps = { path: string; root?: string }

const file = ({ path, root = '/tv' }: FileProps) => {
  const inside = path.slice(root.length + 1)
  const slash = inside.lastIndexOf('/')
  return {
    path,
    folder: slash < 0 ? '' : inside.slice(0, slash),
    fileName: inside.slice(slash + 1),
  }
}

describe('where a file sits', () => {
  it('takes the extension off a name, but not a leading dot', () => {
    expect(stemOf('Heat (1995).mkv')).toBe('Heat (1995)')
    expect(stemOf('Heat.1995.1080p.mkv')).toBe('Heat.1995.1080p')
    expect(stemOf('.hidden')).toBe('.hidden')
    expect(stemOf('README')).toBe('README')
  })

  it('places a file by its path inside the library, and finds the root from it', () => {
    const inFolder = file({ path: '/tv/Severance/Season 01/Severance - S01E01.mkv' })
    expect(filePlace(inFolder)).toBe('Severance/Season 01/Severance - S01E01.mkv')
    expect(rootOf(inFolder)).toBe('/tv')
    const atRoot = file({ path: '/tv/Severance - S01E01.mkv' })
    expect(filePlace(atRoot)).toBe('Severance - S01E01.mkv')
    expect(rootOf(atRoot)).toBe('/tv')
  })

  it('keeps a show by its folder, every season under it included', () => {
    const episode = file({ path: '/tv/Severance/Season 01/Severance - S01E01.mkv' })
    expect(showFolderOf(episode)).toBe('Severance')
    expect(showPlace(episode)).toBe('Severance')
    expect(showDirOf(episode)).toBe('/tv/Severance')
  })

  it('keeps a file at the root, or in a bare season folder, by itself', () => {
    const atRoot = file({ path: '/tv/Severance - S01E01.mkv' })
    expect(showFolderOf(atRoot)).toBeNull()
    expect(showPlace(atRoot)).toBe('Severance - S01E01.mkv')
    expect(showDirOf(atRoot)).toBe('/tv')
    const seasonOnly = file({ path: '/tv/Season 01/Severance - S01E01.mkv' })
    expect(showFolderOf(seasonOnly)).toBeNull()
    expect(showPlace(seasonOnly)).toBe('Season 01/Severance - S01E01.mkv')
    expect(showDirOf(seasonOnly)).toBe('/tv/Season 01')
  })

  it('tells a folder of one movie, in any number of qualities, from one of several', () => {
    const matrix = 'The Matrix (1999)'
    expect(
      holdsOneMovie({
        folder: matrix,
        files: [
          { folder: matrix, fileName: 'The Matrix (1999) Bluray-1080p.mkv' },
          { folder: matrix, fileName: 'The Matrix (1999) Remux-2160p.mkv' },
          { folder: `${matrix}/Featurettes`, fileName: 'Making Of.mkv' },
        ],
      }),
    ).toBe(true)
    expect(
      holdsOneMovie({
        folder: 'Films',
        files: [
          { folder: 'Films', fileName: 'Heat (1995).mkv' },
          { folder: 'Films', fileName: 'Ronin (1998).mkv' },
        ],
      }),
    ).toBe(false)
    expect(
      holdsOneMovie({ folder: '', files: [{ folder: '', fileName: 'Heat (1995).mkv' }] }),
    ).toBe(false)
  })

  it("keeps a group's decision where its Fix match is kept", () => {
    const none = () => []
    const episode = file({ path: '/tv/Severance/Season 01/Severance - S01E01.mkv' })
    expect(groupPlaceOf({ type: 'show', file: episode, folderFiles: none })).toBe('Severance')
    const loose = file({ path: '/tv/Severance - S01E01.mkv' })
    expect(groupPlaceOf({ type: 'show', file: loose, folderFiles: none })).toBe(
      'Severance - S01E01.mkv',
    )
    const heat = file({ path: '/films/Heat (1995)/Heat (1995) 1080p.mkv', root: '/films' })
    const heatUhd = file({ path: '/films/Heat (1995)/Heat (1995) 2160p.mkv', root: '/films' })
    expect(groupPlaceOf({ type: 'movie', file: heat, folderFiles: () => [heat, heatUhd] })).toBe(
      'Heat (1995)',
    )
    const shared = file({ path: '/films/Michael Mann/Heat (1995).mkv', root: '/films' })
    const thief = file({ path: '/films/Michael Mann/Thief (1981).mkv', root: '/films' })
    expect(groupPlaceOf({ type: 'movie', file: shared, folderFiles: () => [shared, thief] })).toBe(
      'Michael Mann/Heat (1995).mkv',
    )
    const atRoot = file({ path: '/films/Heat (1995).mkv', root: '/films' })
    expect(groupPlaceOf({ type: 'movie', file: atRoot, folderFiles: none })).toBe('Heat (1995).mkv')
  })
})
