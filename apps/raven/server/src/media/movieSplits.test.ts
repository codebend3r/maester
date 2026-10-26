import { MEDIA_SORTS, SPLIT_HOWS } from '@raven/core'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MovieSplits } from '@/media/movieSplits'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

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

type MovieProps = { tmdbId: string; title: string }

const movie = ({ tmdbId, title }: MovieProps): FetchedItem => ({
  ...BLANK_ITEM,
  type: 'movie',
  tmdbId,
  number: null,
  title,
  year: 2004,
})

describe('splitting a movie library’s duplicates', () => {
  const database = testDatabase('raven-splits-')
  const state = { libraryId: 0, ids: new Map<string, number>() }
  const media = () => repositories(database.get()).media
  const splits = () => new MovieSplits(database.get(), media())
  const id = (name: string): number => state.ids.get(name) ?? -1

  type AddMovieProps = { title: string; files: readonly string[] }

  /** A movie and a file for each name, the first the biggest, so best. */
  const addMovie = ({ title, files }: AddMovieProps): number => {
    const { metadata } = repositories(database.get())
    const index = new MediaIndex(database.get())
    const itemId = metadata.save({ item: movie({ tmdbId: title, title }) })
    files.forEach((name, position) => {
      const fileId = index.insert({
        libraryId: state.libraryId,
        kind: 'movies',
        file: {
          path: `/m/${title} (2004)/${name}`,
          root: '/m',
          size: 1000 - position,
          mtimeMs: 1,
        },
      })
      index.saveProbe({ id: fileId, probe: PROBE, tracks: TRACKS })
      metadata.link({ mediaIds: [fileId], itemIds: [itemId] })
      state.ids.set(name, fileId)
    })
    return itemId
  }

  /** The library's cards as the listing gives them: each card's file, how many share it, and its variant. */
  const cards = () =>
    media()
      .list({ libraryId: state.libraryId, sort: MEDIA_SORTS.title, account: TEST_ACCOUNTS.a })
      .map((item) => [item.fileName, item.versions, item.variant])

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

  it('lists a card holding several files, best first, each with the cut its name reads as', () => {
    addMovie({
      title: 'Alexander',
      files: [
        'Alexander (2004) Remux-2160p.mkv',
        'Alexander 2004 Revisited the Final Cut (2004).mkv',
      ],
    })
    addMovie({ title: 'Collateral', files: ['Collateral (2004).mkv'] })

    const movies = splits().list({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })

    expect(movies).toHaveLength(1)
    expect(movies[0]?.cards).toHaveLength(1)
    expect(movies[0]?.cards[0]?.entry.media.versions).toBe(2)
    expect(movies[0]?.cards[0]?.files.map((file) => [file.media.fileName, file.cut])).toEqual([
      ['Alexander (2004) Remux-2160p.mkv', null],
      [
        'Alexander 2004 Revisited the Final Cut (2004).mkv',
        { label: 'Revisited the Final Cut', key: 'revisited final' },
      ],
    ])
    expect(movies[0]?.cards[0]?.entry.media).toBe(movies[0]?.cards[0]?.files[0]?.media)
  })

  it('reads every card’s files in one go and their posters in another, however many movies', () => {
    addMovie({
      title: 'Alexander',
      files: ['Alexander (2004).mkv', 'Alexander (2004) Final Cut.mkv'],
    })
    addMovie({ title: 'Collateral', files: ['Collateral (2004).mkv', 'Collateral (2004) 4K.mkv'] })
    const repository = media()
    const reads = {
      getMany: vi.spyOn(repository, 'getMany'),
      withPosters: vi.spyOn(repository, 'withPosters'),
    }

    const movies = new MovieSplits(database.get(), repository).list({
      libraryId: state.libraryId,
      account: TEST_ACCOUNTS.a,
    })

    expect(movies.map((duplicate) => duplicate.cards[0]?.files.length)).toEqual([2, 2])
    expect(reads.getMany).toHaveBeenCalledTimes(1)
    expect(reads.withPosters).toHaveBeenCalledTimes(1)
  })

  it('splits every file apart onto a card of its own, named by its release, keeping the movie listed', () => {
    const itemId = addMovie({
      title: '300',
      files: ['300 (2007) 2160p HEVC.mkv', '300 (2007) WEBDL-2160p.mkv'],
    })

    const after = splits().split({
      libraryId: state.libraryId,
      mediaId: id('300 (2007) WEBDL-2160p.mkv'),
      how: 'apart',
      account: TEST_ACCOUNTS.a,
    })

    expect(cards()).toEqual([
      ['300 (2007) 2160p HEVC.mkv', 1, '2160p HEVC'],
      ['300 (2007) WEBDL-2160p.mkv', 1, 'WEBDL-2160p'],
    ])
    expect(after.map((split) => split.itemId)).toEqual([itemId])
    expect(after[0]?.cards.map((card) => [card.entry.media.fileName, card.files.length])).toEqual([
      ['300 (2007) 2160p HEVC.mkv', 1],
      ['300 (2007) WEBDL-2160p.mkv', 1],
    ])
  })

  it('splits by cut, keeping two copies of one cut together on the movie’s own card, listed first', () => {
    addMovie({
      title: 'Alexander',
      files: [
        'Alexander (2004) Remux-2160p.mkv',
        'Alexander 2004 Revisited the Final Cut (2004).mkv',
        'Alexander (2004) WEBDL-1080p.mkv',
      ],
    })

    const after = splits().split({
      libraryId: state.libraryId,
      mediaId: id('Alexander (2004) Remux-2160p.mkv'),
      how: 'smart',
      account: TEST_ACCOUNTS.a,
    })

    expect(cards()).toEqual([
      ['Alexander (2004) Remux-2160p.mkv', 2, null],
      ['Alexander 2004 Revisited the Final Cut (2004).mkv', 1, 'Revisited the Final Cut'],
    ])
    expect(after[0]?.cards.map((card) => [card.entry.media.variant, card.files.length])).toEqual([
      [null, 2],
      ['Revisited the Final Cut', 1],
    ])
  })

  it('gives each cut its own card when no file is the plain one', () => {
    addMovie({
      title: 'Avatar',
      files: [
        'Avatar Extended (2009) 2160p HEVC.mkv',
        'Avatar Theatrical Cut (2009) 2160p HEVC.mkv',
      ],
    })

    splits().split({
      libraryId: state.libraryId,
      mediaId: id('Avatar Extended (2009) 2160p HEVC.mkv'),
      how: 'smart',
      account: TEST_ACCOUNTS.a,
    })

    expect(cards().map(([, , variant]) => variant)).toEqual(['Extended', 'Theatrical Cut'])
  })

  it('refuses a smart split when every file reads as the same cut', () => {
    addMovie({
      title: 'Watchmen',
      files: [
        'Watchmen The Ultimate Cut (2009) 2160p HEVC.mkv',
        'Watchmen The Ultimate Cut (2009) WEBDL-2160p.mkv',
      ],
    })

    expect(() =>
      splits().split({
        libraryId: state.libraryId,
        mediaId: id('Watchmen The Ultimate Cut (2009) 2160p HEVC.mkv'),
        how: 'smart',
        account: TEST_ACCOUNTS.a,
      }),
    ).toThrow(ConflictException)
    expect(cards()).toEqual([['Watchmen The Ultimate Cut (2009) 2160p HEVC.mkv', 2, null]])
  })

  it('refuses a smart split when the files name one cut two ways', () => {
    addMovie({
      title: 'Watchmen',
      files: ["Watchmen Director's Cut (2009).mkv", 'Watchmen (Directors Edition) (2009).mkv'],
    })

    const [card] =
      splits().list({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })[0]?.cards ?? []
    expect(card?.files.map((file) => file.cut)).toEqual([
      { label: "Director's Cut", key: 'directors' },
      { label: 'Directors Edition', key: 'directors' },
    ])
    expect(() =>
      splits().split({
        libraryId: state.libraryId,
        mediaId: id("Watchmen Director's Cut (2009).mkv"),
        how: 'smart',
        account: TEST_ACCOUNTS.a,
      }),
    ).toThrow(ConflictException)
  })

  it('puts copies of one cut named two ways on one card, named by the best of them', () => {
    addMovie({
      title: 'Watchmen',
      files: [
        "Watchmen Director's Cut (2009).mkv",
        'Watchmen (Directors Edition) (2009).mkv',
        'Watchmen (2009).mkv',
      ],
    })

    splits().split({
      libraryId: state.libraryId,
      mediaId: id('Watchmen (2009).mkv'),
      how: 'smart',
      account: TEST_ACCOUNTS.a,
    })

    expect(cards()).toEqual([
      ["Watchmen Director's Cut (2009).mkv", 2, "Director's Cut"],
      ['Watchmen (2009).mkv', 1, null],
    ])
  })

  it('refuses a card of one file, and a file that is not a movie in the library', () => {
    addMovie({ title: 'Collateral', files: ['Collateral (2004).mkv'] })

    expect(() =>
      splits().split({
        libraryId: state.libraryId,
        mediaId: id('Collateral (2004).mkv'),
        how: 'apart',
        account: TEST_ACCOUNTS.a,
      }),
    ).toThrow(ConflictException)
    expect(() =>
      splits().split({
        libraryId: state.libraryId,
        mediaId: 999,
        how: SPLIT_HOWS.apart,
        account: TEST_ACCOUNTS.a,
      }),
    ).toThrow(NotFoundException)
  })

  it('puts a split movie back on one card, and a file found later joins the movie’s own card', () => {
    const itemId = addMovie({
      title: '300',
      files: ['300 (2007) 2160p HEVC.mkv', '300 (2007) WEBDL-2160p.mkv'],
    })
    splits().split({
      libraryId: state.libraryId,
      mediaId: id('300 (2007) 2160p HEVC.mkv'),
      how: 'apart',
      account: TEST_ACCOUNTS.a,
    })

    const after = splits().join({ libraryId: state.libraryId, itemId, account: TEST_ACCOUNTS.a })

    expect(cards()).toEqual([['300 (2007) 2160p HEVC.mkv', 2, null]])
    expect(after[0]?.cards.map((card) => card.files.length)).toEqual([2])
    expect(() =>
      splits().join({ libraryId: state.libraryId, itemId, account: TEST_ACCOUNTS.a }),
    ).toThrow(NotFoundException)
  })

  it('leaves a file’s split behind when it is matched to another movie, and keeps it for the same one', () => {
    const alexander = addMovie({
      title: 'Alexander',
      files: ['Alexander (2004) Remux-2160p.mkv', 'Alexander (2004) WEBDL-1080p.mkv'],
    })
    splits().split({
      libraryId: state.libraryId,
      mediaId: id('Alexander (2004) Remux-2160p.mkv'),
      how: 'apart',
      account: TEST_ACCOUNTS.a,
    })
    const { metadata } = repositories(database.get())
    const collateral = metadata.save({ item: movie({ tmdbId: 'Collateral', title: 'Collateral' }) })

    metadata.link({ mediaIds: [id('Alexander (2004) Remux-2160p.mkv')], itemIds: [alexander] })
    metadata.link({ mediaIds: [id('Alexander (2004) WEBDL-1080p.mkv')], itemIds: [collateral] })

    const splitOf = (name: string) =>
      database
        .get()
        .db.prepare<[number], { split: string | null }>('SELECT split FROM media WHERE id = ?')
        .get(id(name))?.split
    expect(splitOf('Alexander (2004) Remux-2160p.mkv')).toBe(
      `file:${id('Alexander (2004) Remux-2160p.mkv')}`,
    )
    expect(splitOf('Alexander (2004) WEBDL-1080p.mkv')).toBeNull()
  })
})
