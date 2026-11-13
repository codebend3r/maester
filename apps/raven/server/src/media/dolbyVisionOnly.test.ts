import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { DolbyVisionOnly } from '@/media/dolbyVisionOnly'
import { MediaIndex } from '@/media/mediaIndex'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

const PROBE = {
  duration: 60,
  width: 3840,
  height: 2160,
  videoCodec: 'hevc',
  videoBitDepth: 10,
  hdr: true,
  isDolbyVisionOnly: false,
  dolbyVisionProfile: null,
  audioCodec: 'eac3',
  audioChannels: 6,
  bitrate: 20_000_000,
}

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

type FetchedProps = Pick<FetchedItem, 'type' | 'tmdbId' | 'title'> & { number?: number | null }

const fetched = ({ type, tmdbId, title, number = null }: FetchedProps): FetchedItem => ({
  ...BLANK_ITEM,
  type,
  tmdbId,
  number,
  title,
})

describe('what in a library is Dolby Vision profile 5', () => {
  const database = testDatabase('raven-dolby-vision-')
  const state = { libraryId: 0, emptyId: 0 }
  const titles = () => new DolbyVisionOnly(database.get(), repositories(database.get()).media)

  type AddFileProps = { libraryId: number; name: string; isDolbyVisionOnly: boolean }

  const addFile = ({ libraryId, name, isDolbyVisionOnly }: AddFileProps): number => {
    const index = new MediaIndex(database.get())
    const id = index.insert({
      libraryId,
      kind: 'shows',
      file: { path: `/tv/${name}`, root: '/tv', size: 100, mtimeMs: 1 },
    })
    index.saveProbe({ id, probe: { ...PROBE, isDolbyVisionOnly }, tracks: TRACKS, chapters: [] })
    return id
  }

  type AddShowProps = { title: string; episodes: readonly boolean[] }

  /** A show of one season, an episode file for each entry, profile 5 where it is true. */
  const addShow = ({ title, episodes }: AddShowProps) => {
    const { metadata } = repositories(database.get())
    const showId = metadata.save({ item: fetched({ type: 'show', tmdbId: title, title }) })
    const seasonId = metadata.save({
      item: fetched({ type: 'season', tmdbId: `${title}-1`, title, number: 1 }),
      parentId: showId,
    })
    episodes.forEach((isDolbyVisionOnly, position) => {
      const number = position + 1
      const episodeId = metadata.save({
        item: fetched({
          type: 'episode',
          tmdbId: `${title}-1-${number}`,
          title: `Episode ${number}`,
          number,
        }),
        parentId: seasonId,
      })
      const id = addFile({
        libraryId: state.libraryId,
        name: `${title} - S01E0${number}.mkv`,
        isDolbyVisionOnly,
      })
      metadata.link({ mediaIds: [id], itemIds: [episodeId] })
    })
  }

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.libraryId = libraries.create({
      name: 'TV 4K',
      paths: ['/tv'],
      settings: { kind: 'shows' },
    }).id
    state.emptyId = libraries.create({
      name: 'TV',
      paths: ['/tv-hd'],
      settings: { kind: 'shows' },
    }).id
    addShow({ title: 'Purple', episodes: [true, false, true] })
    addShow({ title: 'Clean', episodes: [false, false] })
    addFile({ libraryId: state.libraryId, name: 'Loose.mkv', isDolbyVisionOnly: true })
    addFile({ libraryId: state.emptyId, name: 'Other.mkv', isDolbyVisionOnly: false })
  })

  afterAll(database.close)

  it('lists each show with how many of its episodes are, and the files that are no show’s', () => {
    const listing = titles().list({ libraryId: state.libraryId, account: TEST_ACCOUNTS.a })
    expect(
      listing.shows.map(({ entry, episodes }) => [entry.show.title, episodes, entry.episodes]),
    ).toEqual([['Purple', 2, 3]])
    expect(listing.files.map(({ media }) => [media.fileName, media.isDolbyVisionOnly])).toEqual([
      ['Loose.mkv', true],
    ])
  })

  it('counts the titles it lists, and none in a library without any', () => {
    expect(titles().count(state.libraryId)).toBe(2)
    expect(titles().count(state.emptyId)).toBe(0)
    expect(titles().list({ libraryId: state.emptyId, account: TEST_ACCOUNTS.a })).toEqual({
      shows: [],
      files: [],
    })
  })
})
