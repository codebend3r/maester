import { describe, expect, it } from 'bun:test'
import { mediaItem } from '@/test/fixtures'
import { showFolderOf, unmatchedShowsOf } from '@/unmatchedShows'

const episode = ({ id, folder, fileName }: { id: number; folder: string; fileName: string }) =>
  mediaItem({ id, folder, fileName, match: 'unmatched' })

describe('unmatchedShowsOf', () => {
  it('gathers the files under one show folder into one group', () => {
    const files = [1, 2, 3, 4].map((id) =>
      episode({ id, folder: 'Archie/Season 1', fileName: `Archie - S01E0${id}.mkv` }),
    )
    const groups = unmatchedShowsOf(files)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe('Archie')
    expect(groups[0]?.title).toBe('Archie')
    expect(groups[0]?.files.map((file) => file.id)).toEqual([1, 2, 3, 4])
  })

  it('keeps every season of a show folder in its one group', () => {
    const groups = unmatchedShowsOf([
      episode({ id: 1, folder: 'Australia Remastered/Season 1', fileName: 'E01.mkv' }),
      episode({ id: 2, folder: 'Australia Remastered/Season 2', fileName: 'E01.mkv' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.title).toBe('Australia Remastered')
    expect(groups[0]?.files).toHaveLength(2)
  })

  it('orders the groups by their first file', () => {
    const groups = unmatchedShowsOf([
      episode({ id: 1, folder: 'Beta/Season 1', fileName: 'a.mkv' }),
      episode({ id: 2, folder: 'Alpha', fileName: 'a.mkv' }),
      episode({ id: 3, folder: 'Beta', fileName: 'b.mkv' }),
    ])
    expect(groups.map((group) => group.key)).toEqual(['Beta', 'Alpha'])
    expect(groups[0]?.files.map((file) => file.id)).toEqual([1, 3])
  })

  it('gives a file at a root, or in a bare season folder, a group of its own', () => {
    const groups = unmatchedShowsOf([
      episode({ id: 1, folder: '', fileName: 'Loose.S01E01.mkv' }),
      episode({ id: 2, folder: 'Season 1', fileName: 'Other.S01E01.mkv' }),
      episode({ id: 3, folder: 'Season 1', fileName: 'Other.S01E02.mkv' }),
    ])
    expect(groups.map((group) => group.key)).toEqual([
      'Loose.S01E01.mkv',
      'Season 1/Other.S01E01.mkv',
      'Season 1/Other.S01E02.mkv',
    ])
    expect(groups.every((group) => group.files.length === 1)).toBe(true)
  })

  it('gives nothing for nothing', () => {
    expect(unmatchedShowsOf([])).toEqual([])
  })

  it('titles a file named only by its episode code by its tidied file name', () => {
    const groups = unmatchedShowsOf([
      mediaItem({ id: 1, folder: 'Season 1', fileName: 'S01E02.mkv', title: 'S01E02' }),
    ])
    expect(groups[0]?.title).toBe('S01E02')
  })
})

describe('showFolderOf', () => {
  it('is the first folder unless it is a season folder', () => {
    expect(showFolderOf({ folder: 'Archie/Season 1' })).toBe('Archie')
    expect(showFolderOf({ folder: 'Archie' })).toBe('Archie')
    expect(showFolderOf({ folder: 'Season 1/Archie' })).toBeNull()
    expect(showFolderOf({ folder: '' })).toBeNull()
  })
})
