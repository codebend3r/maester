import { DEFAULT_SAGA_BACKDROP, type SagaBackdrop } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MovieSplits } from '@/media/movieSplits'
import { BLANK_ITEM, type FetchedSaga } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const PROBE = {
  duration: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
}

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

const RINGS: FetchedSaga = { tmdbId: '119', name: 'The Lord of the Rings Collection' }

const SLIDE: SagaBackdrop = { type: 'slideshow', motion: 'slide' }

const STILL: SagaBackdrop = { type: 'still', itemId: 1 }

describe("a library's sagas", () => {
  const database = testDatabase('raven-sagas-')
  const state = { libraryId: 0, ids: new Map<string, number>() }
  const media = () => repositories(database.get()).media
  const id = (name: string): number => state.ids.get(name) ?? -1

  /** A movie of `saga` and a file for each name, the first the biggest, so best. */
  const addMovie = ({
    title,
    year,
    files,
  }: {
    title: string
    year: number
    files: readonly string[]
  }): void => {
    const { metadata } = repositories(database.get())
    const index = new MediaIndex(database.get())
    const itemId = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: title, number: null, title, year, saga: RINGS },
    })
    files.forEach((name, position) => {
      const fileId = index.insert({
        libraryId: state.libraryId,
        kind: 'movies',
        file: { path: `/m/${title}/${name}`, root: '/m', size: 1000 - position, mtimeMs: 1 },
      })
      index.saveProbe({ id: fileId, probe: PROBE, tracks: TRACKS })
      metadata.link({ mediaIds: [fileId], itemIds: [itemId] })
      state.ids.set(name, fileId)
    })
  }

  const splitApart = (name: string): void => {
    new MovieSplits(database.get(), media()).split({
      libraryId: state.libraryId,
      mediaId: id(name),
      how: 'apart',
    })
  }

  const sagas = () =>
    media()
      .listSagas(state.libraryId)
      .map((saga) => ({ name: saga.name, files: saga.media.map((item) => item.fileName) }))

  beforeEach(async () => {
    await database.open()
    state.ids.clear()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Movies',
      paths: ['/m'],
      settings: { kind: 'movies' },
    }).id
  })

  afterEach(() => database.close())

  it('makes no saga of one movie split onto two cards', () => {
    addMovie({
      title: 'The Fellowship of the Ring',
      year: 2001,
      files: ['Fellowship 2160p.mkv', 'Fellowship Extended 1080p.mkv'],
    })
    splitApart('Fellowship 2160p.mkv')

    expect(media().list({ libraryId: state.libraryId })).toHaveLength(2)
    expect(sagas()).toEqual([])
  })

  it('lists each movie of a saga once, by its best file, whatever cards it is split onto', () => {
    addMovie({
      title: 'The Two Towers',
      year: 2002,
      files: ['Two Towers 2160p.mkv', 'Two Towers Extended 1080p.mkv'],
    })
    addMovie({ title: 'The Fellowship of the Ring', year: 2001, files: ['Fellowship.mkv'] })
    splitApart('Two Towers Extended 1080p.mkv')

    expect(sagas()).toEqual([
      { name: RINGS.name, files: ['Fellowship.mkv', 'Two Towers 2160p.mkv'] },
    ])
  })

  it('shows the default slideshow until the library picks a backdrop, and only its own pick', () => {
    addMovie({ title: 'The Fellowship of the Ring', year: 2001, files: ['Fellowship.mkv'] })
    addMovie({ title: 'The Two Towers', year: 2002, files: ['Two Towers.mkv'] })
    const backdrops = () =>
      media()
        .listSagas(state.libraryId)
        .map((saga) => saga.backdrop)
    const { sagaBackdrops } = repositories(database.get())
    expect(backdrops()).toEqual([DEFAULT_SAGA_BACKDROP])

    sagaBackdrops.save({ libraryId: state.libraryId, sagaId: RINGS.tmdbId, backdrop: SLIDE })
    const other = new LibrariesRepository(database.get()).create({
      name: 'Films',
      paths: ['/f'],
      settings: { kind: 'movies' },
    }).id
    sagaBackdrops.save({ libraryId: other, sagaId: RINGS.tmdbId, backdrop: STILL })
    expect(backdrops()).toEqual([SLIDE])

    sagaBackdrops.save({ libraryId: state.libraryId, sagaId: RINGS.tmdbId, backdrop: STILL })
    expect(backdrops()).toEqual([STILL])
  })

  it('shows the default for a stored backdrop that no longer reads as one', () => {
    addMovie({ title: 'The Fellowship of the Ring', year: 2001, files: ['Fellowship.mkv'] })
    addMovie({ title: 'The Two Towers', year: 2002, files: ['Two Towers.mkv'] })
    database
      .get()
      .db.prepare(
        'INSERT INTO saga_backdrops (library_id, saga_tmdb_id, backdrop) VALUES (?, ?, ?)',
      )
      .run(state.libraryId, RINGS.tmdbId, JSON.stringify({ type: 'spin' }))
    expect(
      media()
        .listSagas(state.libraryId)
        .map((saga) => saga.backdrop),
    ).toEqual([DEFAULT_SAGA_BACKDROP])
  })
})
