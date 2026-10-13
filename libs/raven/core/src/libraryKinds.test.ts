import { describe, expect, it } from 'bun:test'
import { TIER_SETS } from '@/candidateTiers'
import { LIBRARY_KINDS, type LibraryKind, type LibrarySettings } from '@/contract'
import {
  DEFAULT_LIBRARY_SETTINGS,
  KIND_RULES,
  MATCHED_KINDS,
  coherentSettings,
  defaultLibrarySettings,
  firstTierFor,
  groupingsFor,
  listsShows,
  matchTypeFor,
  matchesAlike,
  sortsFor,
  tiersFor,
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

  it('reads anime, family and documentaries like the movies or shows they are, preferring their own results', () => {
    expect({ ...KIND_RULES.animeMovies, prefer: 'any' }).toEqual(KIND_RULES.movies)
    expect({ ...KIND_RULES.animeShows, prefer: 'any' }).toEqual(KIND_RULES.shows)
    expect({ ...KIND_RULES.familyMovies, prefer: 'any' }).toEqual(KIND_RULES.movies)
    expect({ ...KIND_RULES.familyShows, prefer: 'any' }).toEqual(KIND_RULES.shows)
    expect({ ...KIND_RULES.documentaries, prefer: 'any' }).toEqual(KIND_RULES.movies)
    expect(KIND_RULES.sports).toEqual(KIND_RULES.other)
    expect(KIND_RULES.youtube).toEqual(KIND_RULES.other)
  })

  it('prefers Japanese animation in Anime libraries, family and animation in Family ones, and documentaries in Documentaries', () => {
    expect(LIBRARY_KINDS.map((kind) => [kind, KIND_RULES[kind].prefer])).toEqual([
      ['movies', 'any'],
      ['shows', 'any'],
      ['animeMovies', 'anime'],
      ['animeShows', 'anime'],
      ['familyMovies', 'family'],
      ['familyShows', 'family'],
      ['documentaries', 'documentary'],
      ['sports', 'any'],
      ['youtube', 'any'],
      ['other', 'any'],
    ])
    expect(tiersFor('animeShows')).toBe(TIER_SETS.anime)
    expect(tiersFor('movies')).toBe(TIER_SETS.any)
    expect(firstTierFor('animeMovies')).toEqual({
      genres: [16],
      languages: ['ja'],
      countries: ['JP'],
    })
    expect(firstTierFor('shows')).toEqual({})
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

describe('matchesAlike', () => {
  it('says only types matched to the same thing, preferring the same results, match alike', () => {
    const alike = (before: LibraryKind, after: LibraryKind): boolean =>
      matchesAlike({ before, after })
    expect(alike('movies', 'movies')).toBe(true)
    expect(alike('movies', 'animeMovies')).toBe(false)
    expect(alike('movies', 'documentaries')).toBe(false)
    expect(alike('animeMovies', 'familyMovies')).toBe(false)
    expect(alike('animeMovies', 'animeShows')).toBe(false)
    expect(alike('shows', 'animeShows')).toBe(false)
    expect(alike('movies', 'other')).toBe(false)
    expect(alike('sports', 'other')).toBe(true)
    expect(alike('youtube', 'sports')).toBe(true)
  })
})
