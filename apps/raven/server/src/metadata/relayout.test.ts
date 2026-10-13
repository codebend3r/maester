import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { localSeason } from '@/metadata/localItems'
import { MatchFiles } from '@/metadata/matchFiles'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { planRelayout } from '@/scanner/layout'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

/** The least TMDB item `MetadataRepository.save` takes, as `metadataRepository.test.ts` builds one. */
const fetched = ({ type, tmdbId }: { type: FetchedItem['type']; tmdbId: string }): FetchedItem => ({
  ...localSeason({ showTmdbId: '1', number: 1 }),
  type,
  tmdbId,
  number: null,
  title: tmdbId,
  credits: [],
})

describe('relayout', () => {
  const database = testDatabase('raven-relayout-')
  beforeAll(database.open)
  afterAll(database.close)

  const setUp = ({
    kind,
    root,
    paths,
  }: {
    kind: 'shows' | 'movies'
    root: string
    paths: string[]
  }) => {
    const libraries = new LibrariesRepository(database.get())
    const { metadata } = repositories(database.get())
    const files = new MatchFiles(database.get(), metadata)
    const index = new MediaIndex(database.get())
    const library = libraries.create({ name: kind, paths: [root], settings: { kind } })
    const ids = paths.map((path) =>
      index.insert({ libraryId: library.id, kind, file: { path, root, size: 1, mtimeMs: 1 } }),
    )
    return { library, files, metadata, ids }
  }

  it("sends regrouped show files back to matching, and drops a whole letter's Fix match", () => {
    const { library, files, metadata, ids } = setUp({
      kind: 'shows',
      root: '/m/TV',
      paths: [
        '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv',
        '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv',
      ],
    })
    const show = metadata.save({ item: fetched({ type: 'show', tmdbId: '1' }) })
    files.settle({ ids, itemIds: [show], match: 'matched' })
    files.saveFixMatch({ libraryId: library.id, place: 'A', fix: { kind: 'tmdb', tmdbId: '1' } })

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'shows',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'shows', plan })

    expect(files.byIds(ids).map((file) => [file.folder, file.match])).toEqual([
      ['Andor/Season 1', 'pending'],
      ['Ahsoka/Season 1', 'pending'],
    ])
    expect(metadata.mediaUnder(show)).toEqual([])
    expect(files.fixMatchAt({ libraryId: library.id, place: 'A' })).toEqual({ kind: 'none' })
  })

  it("keeps a movie's match and moves its Fix match with its folder", () => {
    const { library, files, metadata, ids } = setUp({
      kind: 'movies',
      root: '/m/Movies',
      paths: ['/m/Movies/A/Alien (1979)/Alien (1979).mkv'],
    })
    const movie = metadata.save({ item: fetched({ type: 'movie', tmdbId: '348' }) })
    files.settle({ ids, itemIds: [movie], match: 'manual' })
    files.saveFixMatch({
      libraryId: library.id,
      place: 'A/Alien (1979)',
      fix: { kind: 'tmdb', tmdbId: '348' },
    })

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'movies',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'movies', plan })

    expect(files.byIds(ids).map((file) => [file.folder, file.match])).toEqual([
      ['Alien (1979)', 'manual'],
    ])
    expect(metadata.mediaUnder(movie)).toEqual(ids)
    expect(files.fixMatchAt({ libraryId: library.id, place: 'Alien (1979)' })).toEqual({
      kind: 'tmdb',
      tmdbId: '348',
    })
    expect(files.fixMatchAt({ libraryId: library.id, place: 'A/Alien (1979)' })).toEqual({
      kind: 'none',
    })
  })

  it("keeps a movie's match when only its stored title is stale, and its new folder reads it the same", () => {
    const { library, files, metadata, ids } = setUp({
      kind: 'movies',
      root: '/m/Films',
      paths: ['/m/Films/B/Blade Runner (1982)/Blade Runner (1982).mkv'],
    })
    const movie = metadata.save({ item: fetched({ type: 'movie', tmdbId: '78' }) })
    files.settle({ ids, itemIds: [movie], match: 'matched' })
    const [id] = ids
    database.get().db.prepare("UPDATE media SET title = 'Old Title' WHERE id = ?").run(id)

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'movies',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'movies', plan })

    expect(files.byIds(ids).map((file) => [file.folder, file.title, file.match])).toEqual([
      ['Blade Runner (1982)', 'Old Title', 'matched'],
    ])
    expect(metadata.mediaUnder(movie)).toEqual(ids)
  })

  it('moves Fix matches along a chain without one overwriting the next', () => {
    const { library, files } = setUp({
      kind: 'shows',
      root: '/m/Series',
      paths: [
        '/m/Series/Anime/K/Season 1/K - S01E01.mkv',
        '/m/Series/K/Kingdom/Season 1/Kingdom - S01E01.mkv',
      ],
    })
    files.saveFixMatch({
      libraryId: library.id,
      place: 'Anime',
      fix: { kind: 'tmdb', tmdbId: '46298' },
    })
    files.saveFixMatch({
      libraryId: library.id,
      place: 'K',
      fix: { kind: 'tmdb', tmdbId: '70523' },
    })

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'shows',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'shows', plan })

    expect(files.fixMatchAt({ libraryId: library.id, place: 'K' })).toEqual({
      kind: 'tmdb',
      tmdbId: '46298',
    })
    expect(files.fixMatchAt({ libraryId: library.id, place: 'Kingdom' })).toEqual({
      kind: 'tmdb',
      tmdbId: '70523',
    })
    expect(files.fixMatchAt({ libraryId: library.id, place: 'Anime' })).toEqual({ kind: 'none' })
  })

  it('finds nothing more to do when read again straight after', () => {
    const { library, files } = setUp({
      kind: 'shows',
      root: '/m/Telly',
      paths: [
        '/m/Telly/A/Andor/Season 1/Andor - S01E01.mkv',
        '/m/Telly/K/K/Season 1/K - S01E01.mkv',
        '/m/Telly/A/Archer - S01E01.mkv',
        '/m/Telly/Pilot.mkv',
      ],
    })
    files.saveFixMatch({ libraryId: library.id, place: 'A', fix: { kind: 'not-a-match' } })
    files.saveFixMatch({
      libraryId: library.id,
      place: 'K',
      fix: { kind: 'tmdb', tmdbId: '46298' },
    })
    const plan = () =>
      planRelayout({
        rows: files.layoutRows(library.id),
        roots: library.paths,
        kind: 'shows',
        layout: 'auto',
        overrides: files.overridePlaces(library.id),
      })

    files.applyRelayout({ libraryId: library.id, kind: 'shows', plan: plan() })

    expect(plan()).toEqual({ moves: [], overrides: [] })
  })

  it('matches a movie again when its new folder reads it as another title', () => {
    const { library, files, ids } = setUp({
      kind: 'movies',
      root: '/m/Animation',
      paths: ['/m/Animation/Other/Paperman (2012)/Paperman (2012).mkv'],
    })
    expect(files.byIds(ids).map((file) => file.match)).toEqual(['off'])

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'movies',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'movies', plan })

    expect(
      files.byIds(ids).map((file) => [file.folder, file.title, file.year, file.match]),
    ).toEqual([['Paperman (2012)', 'Paperman', 2012, 'pending']])
  })
})
