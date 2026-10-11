import { describe, expect, it } from 'vitest'
import {
  foldTitle,
  isExtra,
  parseEpisodeName,
  parseMovieName,
  seasonFolderNumber,
  sortTitle,
} from '@/naming'

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

  it('puts an article sorted to the end back in front', () => {
    expect(movie('Whale, The (2022)/Whale, The (2022) WEBDL-2160p.mkv')).toMatchObject({
      title: 'The Whale',
      year: 2022,
    })
    expect(movie('Knights Tale, A (2001).mkv')).toMatchObject({ title: 'A Knights Tale' })
    expect(movie('Dances with Wolves, The Directors Cut (1990).mkv')).toMatchObject({
      title: 'The Dances with Wolves',
      edition: 'Directors Cut',
    })
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

  it.each([
    ['Avatar Theatrical Cut (2009) 2160p HEVC.mkv', 'Avatar', 'Theatrical Cut'],
    [
      'Dances with Wolves (Directors Cut) (1990) WEBDL-2160p.mkv',
      'Dances with Wolves',
      'Directors Cut',
    ],
    ['Spy (Extended) (2015) WEBDL-2160p.mkv', 'Spy', 'Extended'],
    ['Martian, The (Extended Cut) (2015).mkv', 'The Martian', 'Extended Cut'],
    [
      'Hobbit an Unexpected Journey, The (Extended) (2012).mkv',
      'The Hobbit an Unexpected Journey',
      'Extended',
    ],
    ['Invitation (Unrated Edition) (2022).mkv', 'Invitation', 'Unrated Edition'],
    ['Aliens 20th Anniversary Edition (1986).mkv', 'Aliens', '20th Anniversary Edition'],
    ['Blade Runner [Final Cut] (1982).mkv', 'Blade Runner', 'Final Cut'],
  ])('reads the edition named bare in %s', (path, title, edition) => {
    expect(movie(path)).toMatchObject({ title, edition })
  })

  it('leaves a title that only ends in Cut or Edition alone', () => {
    expect(movie('The Final Cut (2004).mkv')).toMatchObject({
      title: 'The Final Cut',
      edition: null,
    })
    expect(movie('Special (2006).mkv')).toMatchObject({ title: 'Special', edition: null })
    expect(movie('Director (2021).mkv')).toMatchObject({ title: 'Director', edition: null })
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
  it('drops an apostrophe rather than splitting the word at it', () => {
    expect(foldTitle("The King's Man")).toBe(foldTitle('The Kings Man'))
    expect(foldTitle('The World’s End')).toBe('worlds end')
  })

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

describe('seasonFolderNumber', () => {
  it('reads season folders and Specials, and nothing else', () => {
    expect(seasonFolderNumber('Season 1')).toBe(1)
    expect(seasonFolderNumber('Season 01')).toBe(1)
    expect(seasonFolderNumber('Specials')).toBe(0)
    expect(seasonFolderNumber('Severance (2022)')).toBeNull()
    expect(seasonFolderNumber('Season One')).toBeNull()
  })
})

describe('parseEpisodeName', () => {
  const episode = (path: string, fallbackShow = '') => {
    const parts = path.split('/')
    return parseEpisodeName({
      fileName: parts.at(-1) ?? '',
      folder: parts.slice(0, -1).join('/'),
      fallbackShow,
    })
  }

  it.each([
    [
      'Severance (2022)/Season 01/Severance - S01E02 - Half Loop WEBDL-2160p.mkv',
      'Severance',
      2022,
      1,
      [2],
      'Half Loop',
    ],
    [
      'Frieren/Season 01/Frieren - (0012) S01E012 - A Real Hero Bluray-1080p.mkv',
      'Frieren',
      null,
      1,
      [12],
      'A Real Hero',
    ],
    [
      'The Office (US)/Specials/The Office (US) - S00E03.mkv',
      'The Office (US)',
      null,
      0,
      [3],
      null,
    ],
    ['Fargo/Fargo.S02E09E10.1080p.mkv', 'Fargo', 2, 2, [9, 10], null],
    [
      'Fargo/Season 2/Fargo - S02E01-E02 - Waiting for Dutch.mkv',
      'Fargo',
      null,
      2,
      [1, 2],
      'Waiting for Dutch',
    ],
    ['Lost/Season 1/lost.1x02.pilot.part.2.hdtv.mkv', 'Lost', null, 1, [2], 'pilot part 2'],
  ])('reads %s', (path, show, year, season, episodes, title) => {
    const parsed = episode(path)
    expect(parsed.show).toBe(show)
    expect(parsed.year).toBe(typeof year === 'number' && year > 100 ? year : null)
    expect(parsed.season).toBe(season)
    expect(parsed.episodes).toEqual(episodes)
    expect(parsed.title).toBe(title)
  })

  it('reads the show from the file at a library root or in a season folder, then the library', () => {
    expect(episode('Severance - S01E02 - Half Loop.mkv').show).toBe('Severance')
    expect(episode('Season 1/Severance - S01E02.mkv').show).toBe('Severance')
    expect(episode('Season 1/S01E02.mkv', 'Severance').show).toBe('Severance')
  })

  it('puts a show article sorted to the end back in front', () => {
    expect(episode('Office, The/Season 1/Office, The - S01E01 - Pilot.mkv')).toMatchObject({
      show: 'The Office',
      season: 1,
      episodes: [1],
    })
  })

  it('takes the season from the folder when the name has no code', () => {
    expect(episode('Show/Season 3/Episode Four.mkv')).toMatchObject({
      season: 3,
      episodes: [],
      title: null,
    })
  })

  it('reads an absolute number and an air date without taking either for a year', () => {
    expect(episode('Frieren/Season 01/Frieren - (2001) S01E01.mkv')).toMatchObject({
      year: null,
      absolute: 2001,
      episodes: [1],
    })
    expect(episode('The Daily/The Daily - 2026.10.09 - Friday.mkv')).toMatchObject({
      airDate: '2026-10-09',
      episodes: [],
    })
  })

  it('never reads a resolution as a 1x02 code', () => {
    expect(episode('Show/Show.1920x1080.S01E03.mkv').episodes).toEqual([3])
  })

  it('takes ids from the show folder', () => {
    expect(
      episode('Severance (2022) {tvdb-371980}/Season 01/Severance - S01E01.mkv').ids.tvdb,
    ).toBe('371980')
  })
})
