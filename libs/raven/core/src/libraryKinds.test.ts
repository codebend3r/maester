import { describe, expect, it } from 'vitest'
import { LIBRARY_KINDS, type LibrarySettings } from '@/contract'
import {
  DEFAULT_LIBRARY_SETTINGS,
  KIND_RULES,
  MATCHED_KINDS,
  coherentSettings,
  defaultLibrarySettings,
  groupingsFor,
  listsShows,
  matchTypeFor,
  sortsFor,
  viewsFor,
  withLibraryKind,
} from '@/libraryKinds'

describe('defaultLibrarySettings', () => {
  it('groups a new Movies library by match, and lays the others out in a grid', () => {
    expect(defaultLibrarySettings('movies')).toMatchObject({
      kind: 'movies',
      view: 'grouped',
      groupBy: 'match',
    })
    expect(defaultLibrarySettings('shows')).toMatchObject({
      kind: 'shows',
      view: 'grid',
      groupBy: 'resolution',
    })
    expect(defaultLibrarySettings('animeMovies')).toMatchObject({
      view: 'grouped',
      groupBy: 'match',
    })
    expect(defaultLibrarySettings('other')).toEqual(DEFAULT_LIBRARY_SETTINGS)
  })

  it('starts every type with settings it can show', () => {
    LIBRARY_KINDS.forEach((kind) => {
      const settings = defaultLibrarySettings(kind)
      expect(coherentSettings(settings)).toEqual(settings)
    })
  })
})

describe('withLibraryKind', () => {
  it('swaps a view or grouping the new type cannot show for its own, and keeps the rest', () => {
    const movies: LibrarySettings = { ...defaultLibrarySettings('movies'), sort: 'added' }
    expect(withLibraryKind({ settings: movies, kind: 'other' })).toMatchObject({
      kind: 'other',
      view: 'grouped',
      groupBy: 'resolution',
      sort: 'added',
    })
    expect(withLibraryKind({ settings: movies, kind: 'shows' })).toMatchObject({
      kind: 'shows',
      view: 'grid',
      groupBy: 'match',
    })
    const list: LibrarySettings = { ...DEFAULT_LIBRARY_SETTINGS, view: 'list' }
    expect(withLibraryKind({ settings: list, kind: 'movies' })).toMatchObject({
      kind: 'movies',
      view: 'list',
      groupBy: 'resolution',
    })
  })

  it('swaps a sort the new type has no use for back to title', () => {
    const movies: LibrarySettings = { ...defaultLibrarySettings('movies'), sort: 'year-new' }
    expect(withLibraryKind({ settings: movies, kind: 'other' }).sort).toBe('title')
    const clips: LibrarySettings = { ...DEFAULT_LIBRARY_SETTINGS, sort: 'largest' }
    expect(withLibraryKind({ settings: clips, kind: 'shows' }).sort).toBe('title')
  })

  it('keeps the lock, whatever the type', () => {
    const locked: LibrarySettings = { ...DEFAULT_LIBRARY_SETTINGS, locked: true }
    LIBRARY_KINDS.forEach((kind) => {
      expect(withLibraryKind({ settings: locked, kind }).locked).toBe(true)
      expect(coherentSettings({ ...defaultLibrarySettings(kind), locked: true }).locked).toBe(true)
    })
  })
})

describe('the rules for each type of library', () => {
  it('matches movies and shows libraries, anime, family and documentaries included, to movies and shows', () => {
    expect(MATCHED_KINDS).toEqual([
      'movies',
      'shows',
      'animeMovies',
      'animeShows',
      'familyMovies',
      'familyShows',
      'documentaries',
    ])
    expect(LIBRARY_KINDS.map((kind) => [kind, matchTypeFor(kind)])).toEqual([
      ['movies', 'movie'],
      ['shows', 'show'],
      ['animeMovies', 'movie'],
      ['animeShows', 'show'],
      ['familyMovies', 'movie'],
      ['familyShows', 'show'],
      ['documentaries', 'movie'],
      ['sports', null],
      ['youtube', null],
      ['other', null],
    ])
  })

  it('reads anime like the movies or shows it is, and sporting events and YouTube videos like Other', () => {
    expect(KIND_RULES.animeMovies).toEqual(KIND_RULES.movies)
    expect(KIND_RULES.animeShows).toEqual(KIND_RULES.shows)
    expect(KIND_RULES.familyMovies).toEqual(KIND_RULES.movies)
    expect(KIND_RULES.familyShows).toEqual(KIND_RULES.shows)
    expect(KIND_RULES.documentaries).toEqual(KIND_RULES.movies)
    expect(KIND_RULES.sports).toEqual(KIND_RULES.other)
    expect(KIND_RULES.youtube).toEqual(KIND_RULES.other)
  })

  it('lists the shows of a TV, Anime or Family TV shows library, and the files of the rest', () => {
    expect(LIBRARY_KINDS.filter(listsShows)).toEqual(['shows', 'animeShows', 'familyShows'])
  })

  it('offers every sort to a Movies library', () => {
    expect(sortsFor('movies')).toHaveLength(17)
  })

  it('leaves the per-file sorts out of a TV library, and the release and score sorts out of an Other one', () => {
    expect(sortsFor('shows')).not.toContain('largest')
    expect(sortsFor('shows')).not.toContain('resolution-low')
    expect(sortsFor('shows')).toContain('year-new')
    expect(sortsFor('shows')).toContain('bitrate-high')
    expect(sortsFor('shows')).toContain('bitrate-low')
    expect(sortsFor('other')).not.toContain('year-new')
    expect(sortsFor('other')).not.toContain('rating-high')
    expect(sortsFor('other')).toContain('largest')
  })

  it('has no grouped view for a TV library, and no match grouping for an Other one', () => {
    expect(viewsFor('shows')).toEqual(['grid', 'list', 'tiles'])
    expect(viewsFor('other')).toContain('grouped')
    expect(groupingsFor('other')).toEqual(['resolution', 'codec', 'month'])
    expect(groupingsFor('movies')).toContain('match')
  })
})

describe('coherentSettings', () => {
  it('groups an Other library by resolution where its settings say match', () => {
    const other: LibrarySettings = {
      ...DEFAULT_LIBRARY_SETTINGS,
      view: 'grouped',
      groupBy: 'match',
    }
    expect(coherentSettings(other)).toMatchObject({ view: 'grouped', groupBy: 'resolution' })
  })

  it('shows a TV library in a grid where its settings say grouped', () => {
    const shows: LibrarySettings = { ...defaultLibrarySettings('shows'), view: 'grouped' }
    expect(coherentSettings(shows).view).toBe('grid')
  })

  it("keeps a TV library's sort by its shows' bitrate, either way", () => {
    const highest: LibrarySettings = { ...defaultLibrarySettings('shows'), sort: 'bitrate-high' }
    expect(coherentSettings(highest).sort).toBe('bitrate-high')
    const lowest: LibrarySettings = { ...defaultLibrarySettings('animeShows'), sort: 'bitrate-low' }
    expect(coherentSettings(lowest).sort).toBe('bitrate-low')
  })

  it('leaves settings the type can show alone', () => {
    const movies: LibrarySettings = {
      ...defaultLibrarySettings('movies'),
      sort: 'rating-high',
      view: 'tiles',
      groupBy: 'codec',
    }
    expect(coherentSettings(movies)).toEqual(movies)
  })
})
