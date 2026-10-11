import { describe, expect, it } from 'vitest'
import { foldTitle, isExtra, parseMovieName, sortTitle } from '@/naming'

/** Splits `Folder/Sub/file.mkv` the way the scanner stores it: a relative folder and a name. */
const movie = (path: string) => {
  const parts = path.split('/')
  return parseMovieName({ fileName: parts.at(-1) ?? '', folder: parts.slice(0, -1).join('/') })
}

describe('parseMovieName', () => {
  it.each([
    ['The Matrix (1999)/The Matrix (1999) Bluray-1080p.mkv', 'The Matrix', 1999],
    ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', 'The Matrix', 1999],
    ['1917 (2019)/1917 (2019) WEBDL-2160p.mkv', '1917', 2019],
    ['2001.A.Space.Odyssey.1968.2160p.UHD.mkv', '2001 A Space Odyssey', 1968],
    ['Busboys (2026) 1080p WEBRip.mkv', 'Busboys', 2026],
    ['Movies/Heat (1995)/Heat (1995) Remux-2160p.mkv', 'Heat', 1995],
    ['Mr. Nobody (2009).mkv', 'Mr. Nobody', 2009],
    ['Blade Runner 2049 (2017)/Blade.Runner.2049.2017.2160p.mkv', 'Blade Runner 2049', 2017],
    ['Se7en.1995.REMUX.mkv', 'Se7en', 1995],
    ['Wall_E_2008_720p.mp4', 'Wall E', 2008],
  ])('reads %s', (path, title, year) => {
    expect(movie(path)).toMatchObject({ title, year })
  })

  it('reads a name with no year up to its release tags', () => {
    expect(movie('Some.Home.Movie.1080p.WEB-DL.mkv')).toMatchObject({
      title: 'Some Home Movie',
      year: null,
    })
    expect(movie('Holiday Clip.mp4')).toMatchObject({ title: 'Holiday Clip', year: null })
  })

  it('never reads a title that is a year as the year itself', () => {
    expect(movie('1917.mkv')).toMatchObject({ title: '1917', year: null })
    expect(movie('2012.2009.1080p.mkv')).toMatchObject({ title: '2012', year: 2009 })
  })

  it('reads the file when its folder has no year', () => {
    expect(movie('Classics/The Third Man (1949) Bluray-1080p.mkv')).toMatchObject({
      title: 'The Third Man',
      year: 1949,
    })
  })

  it('takes ids from the folder and the file', () => {
    expect(movie('Blade Runner 2049 (2017) {imdb-tt1856101}/Blade Runner 2049 (2017).mkv')).toEqual(
      {
        title: 'Blade Runner 2049',
        year: 2017,
        edition: null,
        ids: { tmdb: null, imdb: 'tt1856101', tvdb: null },
      },
    )
    expect(movie('The Matrix (1999) [tmdbid-603]/The Matrix (1999) {tvdb-169}.mkv').ids).toEqual({
      tmdb: '603',
      imdb: null,
      tvdb: '169',
    })
  })

  it('takes the edition out of the title', () => {
    expect(movie('Aliens (1986) {edition-Special Edition}.mkv')).toMatchObject({
      title: 'Aliens',
      year: 1986,
      edition: 'Special Edition',
    })
  })
})

describe('isExtra', () => {
  it.each([
    ['The Matrix (1999)/Featurettes', 'Making Of.mkv'],
    ['The Matrix (1999)/Behind The Scenes', 'Bullet Time.mkv'],
    ['Show/Season 1/Extras', 'Gag Reel.mkv'],
    ['The Matrix (1999)', 'The Matrix (1999)-trailer.mkv'],
    ['', 'Heat (1995)-deleted.mp4'],
  ])('knows %s/%s is an extra', (folder, fileName) => {
    expect(isExtra({ folder, fileName })).toBe(true)
  })

  it.each([
    ['The Matrix (1999)', 'The Matrix (1999).mkv'],
    ['Show/Specials', 'Show - S00E01.mkv'],
    ['Others', 'Trailer Park Boys (2001).mkv'],
  ])('knows %s/%s is not', (folder, fileName) => {
    expect(isExtra({ folder, fileName })).toBe(false)
  })
})

describe('foldTitle', () => {
  it('folds case, accents, punctuation, ampersands and a leading article', () => {
    expect(foldTitle('The Lord of the Rings: The Return of the King')).toBe(
      'lord of the rings the return of the king',
    )
    expect(foldTitle('Amélie')).toBe('amelie')
    expect(foldTitle('Fast & Furious')).toBe(foldTitle('Fast and Furious'))
    expect(foldTitle('A Quiet Place')).toBe('quiet place')
    expect(foldTitle('WALL·E')).toBe('wall e')
  })
})

describe('sortTitle', () => {
  it('drops a leading article', () => {
    expect(sortTitle('The Matrix')).toBe('Matrix')
    expect(sortTitle('An American Werewolf in London')).toBe('American Werewolf in London')
    expect(sortTitle('Annie Hall')).toBe('Annie Hall')
  })
})
