import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listFolder, movieAssets } from '@/metadata/localAssets'

describe('movieAssets', () => {
  const names = [
    'The Matrix (1999).mkv',
    'Folder.JPG',
    'fanart.webp',
    'movie.nfo',
    'The Matrix (1999)-poster.png',
    'notes.txt',
  ]

  it('takes the folder pictures and NFO when the folder holds one movie', () => {
    expect(movieAssets({ names, stem: 'The Matrix (1999)', ownFolder: true })).toEqual({
      poster: 'The Matrix (1999)-poster.png',
      backdrop: 'fanart.webp',
      nfo: 'movie.nfo',
    })
    expect(
      movieAssets({
        names: names.filter((name) => !name.includes('-poster')),
        stem: 'x',
        ownFolder: true,
      }).poster,
    ).toBe('Folder.JPG')
  })

  it("only takes a file's own pictures in a shared folder", () => {
    expect(movieAssets({ names, stem: 'Heat (1995)', ownFolder: false })).toEqual({
      poster: null,
      backdrop: null,
      nfo: null,
    })
  })

  it('lists a folder, and nothing for one that is not there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raven-assets-'))
    try {
      await writeFile(join(dir, 'poster.jpg'), '')
      await expect(listFolder(dir)).resolves.toEqual(['poster.jpg'])
      await expect(listFolder(join(dir, 'missing'))).resolves.toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
