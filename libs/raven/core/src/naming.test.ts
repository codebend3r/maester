import { describe, expect, it } from 'bun:test'
import {
  canSplitByCut,
  foldTitle,
  isExtra,
  parseEpisodeName,
  parseMovieName,
  readCut,
  readRelease,
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
        alternatives: [],
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

  it('ends a title at its own year, and drops a region code', () => {
    expect(movie('Alexander 2004 Revisited the Final Cut (2004) WEBDL-2160p.mkv')).toMatchObject({
      title: 'Alexander',
      year: 2004,
      edition: 'Final Cut',
    })
    expect(movie('Blade Runner 2049 (2017).mkv')).toMatchObject({ title: 'Blade Runner 2049' })
    expect(movie('2012 (2012).mkv')).toMatchObject({ title: '2012', year: 2012 })
    expect(movie('Death to 2020 (2020)/Death to 2020 (2020) 1080p WEBDL.mkv')).toMatchObject({
      title: 'Death to 2020',
      year: 2020,
    })
    expect(movie('Alien Resurrection R2 Special Edition (1997).mkv')).toMatchObject({
      title: 'Alien Resurrection',
      edition: 'Special Edition',
    })
  })

  it('leaves a title that only ends in Cut or Edition alone', () => {
    expect(movie('The Final Cut (2004).mkv')).toMatchObject({
      title: 'The Final Cut',
      edition: null,
    })
    expect(movie('Special (2006).mkv')).toMatchObject({ title: 'Special', edition: null })
    expect(movie('Director (2021).mkv')).toMatchObject({ title: 'Director', edition: null })
  })

  it("keeps the file's own name to try where its folder names the movie differently", () => {
    expect(movie("Dont Make Me (2022)/Don't Make Me Go (2022) 1080p WEBDL.mkv")).toMatchObject({
      title: 'Dont Make Me',
      year: 2022,
      alternatives: [{ title: "Don't Make Me Go", year: 2022 }],
    })
    expect(movie('Karate Kid, The (2019)/Karate Kid, The (1984) 1080p WEBDL.mkv')).toMatchObject({
      title: 'The Karate Kid',
      year: 2019,
      alternatives: [{ title: 'The Karate Kid', year: 1984 }],
    })
    expect(movie('Swordsmen, The (2020)/Swordsman, The.mkv').alternatives).toEqual([
      { title: 'The Swordsman', year: 2020 },
    ])
  })

  it("keeps the title with its edition to try, as a title can end in an edition's word", () => {
    expect(movie('Redux Redux (2026)/Redux Redux (2026) 1080p WEBDL.mkv')).toMatchObject({
      title: 'Redux',
      edition: 'Redux',
      alternatives: [{ title: 'Redux Redux', year: 2026 }],
    })
  })

  it('has no alternatives when the folder and file agree', () => {
    expect(movie('The Matrix (1999)/The Matrix (1999) Bluray-1080p.mkv').alternatives).toEqual([])
    expect(movie('The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv').alternatives).toEqual([])
    expect(movie('Classics/The Third Man (1949) Bluray-1080p.mkv').alternatives).toEqual([])
  })

  it('takes the edition out of the title', () => {
    expect(movie('Aliens (1986) {edition-Special Edition}.mkv')).toMatchObject({
      title: 'Aliens',
      year: 1986,
      edition: 'Special Edition',
    })
  })
})

describe('readCut', () => {
  it.each([
    ['Alexander 2004 Revisited the Final Cut (2004).mkv', ['Alexander'], 'Revisited the Final Cut'],
    ['Aliens (Special Edition) (1986).mkv', ['Aliens'], 'Special Edition'],
    ['Avatar Extended (2009) 2160p HEVC.mkv', ['Avatar'], 'Extended'],
    ['Avatar Theatrical Cut (2009) 2160p HEVC.mkv', ['Avatar'], 'Theatrical Cut'],
    ['Deadpool 2 Super Duper Cut (2018).mkv', ['Deadpool 2'], 'Super Duper Cut'],
    [
      'Kingdom of Heaven Directors Cut Roadshow Version (2005).mkv',
      ['Kingdom of Heaven'],
      'Directors Cut Roadshow Version',
    ],
    ['Blade Runner (1982) {edition-Final Cut} Remux-2160p.mkv', ['Blade Runner'], 'Final Cut'],
    [
      'Kingdom of Heaven (2005) Directors Cut WEBDL-2160p.mkv',
      ['Kingdom of Heaven'],
      'Directors Cut',
    ],
    ['The.Matrix.1999.Directors.Cut.1080p.BluRay.x264.mkv', ['The Matrix'], 'Directors Cut'],
    ['The Matrix 1999 Extended.mkv', ['The Matrix'], 'Extended'],
  ])('reads %s as the cut %s', (fileName, titles, label) => {
    expect(readCut({ fileName, titles })?.label).toBe(label)
  })

  it.each([
    ['300 (2007) 2160p HEVC.mkv', ['300']],
    ['300 (2007) WEBDL-2160p.mkv', ['300']],
    ['Alexander (2004).mkv', ['Alexander']],
    ['Bobs Burgers Movie, The (2022) 2160p HEVC.mkv', ["The Bob's Burgers Movie"]],
    ['Spider-Man Far From Home (2019) WEBDL-2160p.mkv', ['Spider-Man: Far From Home']],
    ['Fast and Furious (2009).mkv', ['Fast & Furious']],
    ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', ['The Matrix']],
    ['Blade Runner 2049 (2017) Remux-2160p.mkv', ['Blade Runner 2049']],
    ['The Matrix (1999) 4K.mkv', ['The Matrix']],
    ['The Matrix 1999 4K.mkv', ['The Matrix']],
  ])('finds no cut in %s beyond the title, year and release', (fileName, titles) => {
    expect(readCut({ fileName, titles })).toBeNull()
  })

  it('counts the original title as the title too', () => {
    expect(
      readCut({
        fileName: 'Amelie (2001).mkv',
        titles: ['Amélie', 'Le Fabuleux Destin d’Amélie Poulain'],
      }),
    ).toBeNull()
    expect(readCut({ fileName: 'Amelie (2001).mkv', titles: ['Amélie', null] })).toBeNull()
  })

  it('reads a scene name’s cut past its year as a spaced name’s', () => {
    const titles = ['The Matrix']
    expect(
      readCut({ fileName: 'The.Matrix.1999.Directors.Cut.1080p.BluRay.x264.mkv', titles }),
    ).toEqual({ label: 'Directors Cut', key: 'directors' })
    expect(readCut({ fileName: 'The Matrix (1999) Directors Cut 1080p.mkv', titles })).toEqual({
      label: 'Directors Cut',
      key: 'directors',
    })
  })

  it('reads the cut from Plex’s edition tag alone when the name has one', () => {
    expect(
      readCut({
        fileName: 'The Matrix (1999) Extended Cut {edition-Extended Cut}.mkv',
        titles: ['The Matrix'],
      }),
    ).toEqual({ label: 'Extended Cut', key: 'extended' })
  })

  it('folds two namings of one cut to the same key', () => {
    const titles = ['Watchmen']
    expect(readCut({ fileName: "Watchmen Director's Cut (2009).mkv", titles })?.key).toBe(
      readCut({ fileName: 'Watchmen (Directors Edition) (2009).mkv', titles })?.key,
    )
  })

  it('tells a cut from a second copy of the same one', () => {
    const titles = ['Watchmen']
    const webdl = readCut({ fileName: 'Watchmen The Ultimate Cut (2009) WEBDL-2160p.mkv', titles })
    const hevc = readCut({ fileName: 'Watchmen The Ultimate Cut (2009) 2160p HEVC.mkv', titles })
    expect(webdl).toEqual({ label: 'The Ultimate Cut', key: 'ultimate' })
    expect(hevc).toEqual(webdl)
  })
})

describe('canSplitByCut', () => {
  const cut = (label: string, key: string) => ({ cut: { label, key } })

  it('tells files apart by their cuts’ keys, the plain cut counting as one', () => {
    expect(canSplitByCut([{ cut: null }, cut('Final Cut', 'final')])).toBe(true)
    expect(canSplitByCut([cut('Extended', 'extended'), cut('Theatrical Cut', 'theatrical')])).toBe(
      true,
    )
  })

  it('finds nothing to tell apart in one cut named two ways, or in plain copies', () => {
    expect(
      canSplitByCut([cut("Director's Cut", 'directors'), cut('Directors Edition', 'directors')]),
    ).toBe(false)
    expect(canSplitByCut([{ cut: null }, { cut: null }])).toBe(false)
  })
})

describe('readRelease', () => {
  it.each([
    ['300 (2007) 2160p HEVC.mkv', '2160p HEVC'],
    ['300 (2007) WEBDL-2160p.mkv', 'WEBDL-2160p'],
    ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', '1080p BluRay x264-GROUP'],
    ['Alexander (2004) [Remux-2160p].mkv', 'Remux-2160p'],
    ['The Matrix (1999) 4K.mkv', '4K'],
    ['The.Matrix.1999.Directors.Cut.1080p.BluRay.x264.mkv', '1080p BluRay x264'],
  ])('reads the release details of %s as %s', (fileName, release) => {
    expect(readRelease(fileName)).toBe(release)
  })

  it('is null for a name with none', () => {
    expect(readRelease('Aliens (1986).mkv')).toBeNull()
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
  it('reads a number spelt out as its digits', () => {
    expect(foldTitle('The Fantastic Four: First Steps')).toBe(foldTitle('Fantastic 4 First Steps'))
    expect(foldTitle("Ocean's Eleven")).toBe('oceans 11')
    expect(foldTitle('Se7en')).toBe('se7en')
  })

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

  it('ignores the quotes and punctuation a title opens with', () => {
    expect(sortTitle('“Wuthering Heights”')).toBe('Wuthering Heights”')
    expect(sortTitle('"The Matrix"')).toBe('Matrix"')
    expect(sortTitle('(500) Days of Summer')).toBe('500) Days of Summer')
    expect(sortTitle('...And Justice for All')).toBe('And Justice for All')
    expect(sortTitle('¡Three Amigos!')).toBe('Three Amigos!')
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
    ['The Office (US)/Specials/The Office (US) - S00E03.mkv', 'The Office', null, 0, [3], null],
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

  it('keeps the show as the file names it, for when the folder is misspelt', () => {
    const parsed = episode('Muderbot/Season 1/Murderbot - S01E01 - FreeCommerce WEBDL-2160p.mkv')
    expect(parsed).toMatchObject({ show: 'Muderbot', showFromFile: 'Murderbot' })
    expect(episode('Severance (2022)/Season 01/Severance - S01E02.mkv').showFromFile).toBeNull()
    expect(episode('Fargo/Fargo.S02E09E10.1080p.mkv').showFromFile).toBeNull()
  })

  it('keeps a word a movie edition would end with in a show name, as shows have no editions', () => {
    expect(
      episode(
        'Australia Remastered/Season 1/Australia Remastered - S01E01 - Kangaroo Tales WEBDL-1080p.mkv',
      ),
    ).toMatchObject({ show: 'Australia Remastered', showFromFile: null })
    expect(episode('Australia Remastered - S01E01 - Kangaroo Tales.mkv').show).toBe(
      'Australia Remastered',
    )
    expect(
      episode('The Ultimate Fighter Final/Season 1/The Ultimate Fighter Final - S01E01.mkv').show,
    ).toBe('The Ultimate Fighter Final')
  })

  it('drops a country suffix from a show name, as TMDB does not search on it, and keeps the country', () => {
    expect(episode('Euphoria (US)/Season 1/Euphoria (US) - S01E01 - Pilot.mkv')).toMatchObject({
      show: 'Euphoria',
      country: 'US',
    })
    expect(episode('The Office (UK)/Season 1/The Office (UK) - S01E01.mkv')).toMatchObject({
      show: 'The Office',
      country: 'GB',
    })
    expect(episode('Season 1/Shameless (us) - S01E01.mkv')).toMatchObject({
      show: 'Shameless',
      country: 'US',
    })
    expect(episode('Us/Season 1/Us - S01E01.mkv')).toMatchObject({ show: 'Us', country: null })
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
