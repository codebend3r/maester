import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseNfoIds, readNfoIds } from '@/metadata/nfo'

describe('parseNfoIds', () => {
  it("reads Radarr's unique ids", () => {
    expect(
      parseNfoIds(`<?xml version="1.0" encoding="utf-8"?>
<movie>
  <title>The Matrix</title>
  <uniqueid type="imdb" default="true">tt0133093</uniqueid>
  <uniqueid type="tmdb">603</uniqueid>
</movie>`),
    ).toEqual({ tmdb: '603', imdb: 'tt0133093', tvdb: null })
  })

  it('reads the older id elements', () => {
    expect(
      parseNfoIds('<tvshow><tvdbid>81189</tvdbid><imdbid>tt0903747</imdbid></tvshow>'),
    ).toEqual({
      tmdb: null,
      imdb: 'tt0903747',
      tvdb: '81189',
    })
  })

  it('ignores text that is not an NFO, or one without ids', () => {
    expect(parseNfoIds('https://www.imdb.com/title/tt0133093/')).toBeNull()
    expect(parseNfoIds('<movie><title>X</title></movie>')).toBeNull()
  })

  it('reads one from disk, and nothing from a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raven-nfo-'))
    try {
      await writeFile(join(dir, 'movie.nfo'), '<movie><tmdbid>949</tmdbid></movie>')
      await expect(readNfoIds(join(dir, 'movie.nfo'))).resolves.toMatchObject({ tmdb: '949' })
      await expect(readNfoIds(join(dir, 'gone.nfo'))).resolves.toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
