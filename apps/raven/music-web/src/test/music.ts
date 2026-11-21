import type { PlaylistSummary } from '@raven/core'
import {
  AIRBAG_LYRICS,
  FILMS,
  MIXTAPE,
  MIXTAPE_PAGE,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  RADIOHEAD,
  RADIOHEAD_PAGE,
  SONGS,
} from '@raven/wren/testing'
import { useAudioQueue } from '@raven/ui/headless'
import { KIT_COPY } from '@raven/wren'
import { afterEach, beforeEach, mock, spyOn } from 'bun:test'
import { cleanup } from '@testing-library/react'
import { api } from '@/lib/api'

// The library both of Wren's apps' tests read, which `mockMusicApi()` has the page's `api` answer with.
export {
  AIRBAG,
  AUDIOBOOKS,
  FILMS,
  LUCKY,
  MIXTAPE,
  MIXTAPE_PAGE,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  PARANOID,
  RADIOHEAD,
  RADIOHEAD_PAGE,
  SONGS,
  trackFor,
} from '@raven/wren/testing'

/** A cover's version, for a test of an album or a track that has one. */
export const COVER_VERSION = 'cover-v1'

/** What OK Computer's tile is called aloud: its title, then its artist. */
export const OK_COMPUTER_TILE = KIT_COPY.labelled({
  label: OK_COMPUTER.title,
  value: RADIOHEAD.name,
})

/**
 * Has the page's `api` answer with `@raven/wren/testing`'s fixtures in place of the network, each
 * call a spy a test can answer otherwise (`music.listAlbums.mockResolvedValue(...)`) or look at.
 * Call it in a test and `restore()` it after, once the page is unmounted (`cleanup()`), or let
 * `mockMusicApiEach()` do both around every test.
 */
export const mockMusicApi = () => {
  const spies = {
    listLibraries: spyOn(api, 'listLibraries').mockResolvedValue([FILMS, MUSIC]),
    listAlbums: spyOn(api, 'listAlbums').mockResolvedValue([OK_COMPUTER]),
    listArtists: spyOn(api, 'listArtists').mockResolvedValue([RADIOHEAD]),
    listTracks: spyOn(api, 'listTracks').mockResolvedValue(SONGS),
    getAlbum: spyOn(api, 'getAlbum').mockResolvedValue(OK_COMPUTER_PAGE),
    getArtist: spyOn(api, 'getArtist').mockResolvedValue(RADIOHEAD_PAGE),
    listPlaylists: spyOn(api, 'listPlaylists').mockResolvedValue([MIXTAPE]),
    getPlaylist: spyOn(api, 'getPlaylist').mockResolvedValue(MIXTAPE_PAGE),
    getLyrics: spyOn(api, 'getLyrics').mockResolvedValue(AIRBAG_LYRICS),
  }
  return {
    ...spies,
    restore: () => Object.values(spies).forEach((spy) => spy.mockRestore()),
  }
}

/** A playlist the server makes when asked for a new one, empty until tracks are put in it. */
export const ROAD_TRIP: PlaylistSummary = {
  ...MIXTAPE,
  id: MIXTAPE.id + 10,
  name: 'Road trip',
  trackCount: 0,
  duration: 0,
}

/*
 * Has the page's `api` take what a detail page writes in place of the network: a like, a follow,
 * tracks added to a playlist and a new playlist. `mockMusicAndWritesEach()` sets
 * it beside `mockMusicApi()` around every test.
 */
const mockMusicWrites = () => {
  const spies = {
    setAlbumFavourite: spyOn(api, 'setAlbumFavourite').mockImplementation(
      async ({ favourite }) => ({ ...OK_COMPUTER_PAGE, isFavourite: favourite }),
    ),
    setArtistFavourite: spyOn(api, 'setArtistFavourite').mockImplementation(
      async ({ favourite }) => ({ ...RADIOHEAD_PAGE, isFavourite: favourite }),
    ),
    appendPlaylistTracks: spyOn(api, 'appendPlaylistTracks').mockResolvedValue(MIXTAPE_PAGE),
    createPlaylist: spyOn(api, 'createPlaylist').mockResolvedValue({
      playlist: ROAD_TRIP,
      tracks: [],
    }),
  }
  return {
    ...spies,
    restore: () => Object.values(spies).forEach((spy) => spy.mockRestore()),
  }
}

/** What a test's mocks hand back to put the real `api` in their place again. */
type Restorable = { restore: () => void }

/*
 * Runs `mocksOf` before each test of the file or `describe` that calls this and restores it after
 * each, once the page is unmounted, so nothing still drawn asks the real `api`. Returns the way
 * to the mocks of the test running.
 */
const mockedEach = <Mocks extends Restorable>(mocksOf: () => Mocks) => {
  const held: { mocks: Mocks | null } = { mocks: null }
  beforeEach(() => {
    held.mocks = mocksOf()
  })
  afterEach(() => {
    cleanup()
    held.mocks?.restore()
    held.mocks = null
  })
  return (): Mocks => {
    if (held.mocks === null) throw new Error('the api is mocked before each test')
    return held.mocks
  }
}

/** `mockMusicApi()` around each test: `const music = mockMusicApiEach()`, then `music().listAlbums`. */
export const mockMusicApiEach = () => mockedEach(mockMusicApi)

const mockMusicAndWrites = () => {
  const music = mockMusicApi()
  const writes = mockMusicWrites()
  return {
    music,
    writes,
    restore: () => {
      music.restore()
      writes.restore()
    },
  }
}

/** `mockMusicApi()` and `mockMusicWrites()` around each test, as `mocked().music` and `mocked().writes`. */
export const mockMusicAndWritesEach = () => mockedEach(mockMusicAndWrites)

/**
 * Puts mocks in the queue's place before each test of the file or `describe` that calls this,
 * cleared of the last test's calls, and returns them: `const { playTracks } = mockQueueEach()`.
 */
export const mockQueueEach = () => {
  const queue = { playTracks: mock(), playNext: mock(), addToQueue: mock() }
  beforeEach(() => {
    Object.values(queue).forEach((spy) => spy.mockClear())
    useAudioQueue.setState(queue)
  })
  return queue
}
