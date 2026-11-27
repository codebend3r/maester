import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  type AlbumSummary,
  MATCH_STATES,
  MUSIC_PAGE,
  MUSIC_SORT_LABELS,
  MUSIC_SORTS,
  type PlaylistDetails,
  plural,
} from '@raven/core'
import type * as Native from '@raven/native'
import {
  COUNTS_COPY,
  COVER_SIZES,
  KIT_COPY,
  LIBRARY_LABELS,
  LIBRARY_ORDER,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
  countsLineOf,
} from '@raven/wren'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useSongProgress, useWrenAccount, useToast } from '@raven/wren-native'
import { WREN_PAGES, WREN_ROUTES, collectionPathOf } from '@raven/wren-native/headless'
import { DEFAULT_WREN_PREFS, useWrenPrefs } from '@/stores/wrenPrefs'
import {
  AIRBAG,
  FAVOURITES,
  LISTENER,
  LUCKY,
  MIXTAPE,
  MUSIC,
  OK_COMPUTER,
  PARANOID,
  RADIOHEAD,
  keepSongs,
  musicApi,
  trackFor,
} from '@raven/wren-native/testing'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const ROAD_TRIP: PlaylistDetails = {
  playlist: { ...MIXTAPE, id: 12, name: 'Road trip', trackCount: 0, duration: 0 },
  tracks: [],
}

type CreateProps = { name: string }

const mockApi = {
  ...musicApi(),
  createPlaylist: jest.fn(async (_props: CreateProps): Promise<PlaylistDetails> => ROAD_TRIP),
}

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  // jest has no NetInfo native module to ask; the device is on Wi-Fi.
  isOnCellular: async () => false,
  watchNetwork: () => () => undefined,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** A full first page of a library holding more songs than one page. */
const FIRST_PAGE = Array.from({ length: MUSIC_PAGE.most }, (_, at) =>
  trackFor({ id: 1000 + at, title: `Song ${at + 1}` }),
)

const ALBUM_TILE = `${OK_COMPUTER.title}, Radiohead`

/** A second album, before OK Computer by title and after it by year. */
const AMNESIAC: AlbumSummary = {
  ...OK_COMPUTER,
  id: 2,
  title: 'Amnesiac',
  sortTitle: 'Amnesiac',
  year: 2001,
}

/** The albums' titles in the order the grid shows them. */
const shownTitles = () =>
  screen
    .getAllByText(new RegExp(`^(${AMNESIAC.title}|${OK_COMPUTER.title})$`))
    .map((title) => title.props.children)

const SORT_BUTTON = LIBRARY_PAGE_COPY.sortLabel(MUSIC_SORT_LABELS[MUSIC_SORTS.title])

const COVER_SIZE_BUTTON = LIBRARY_PAGE_COPY.coverSizeLabel(
  LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.medium],
)

describe('Library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useSongProgress.setState({ songs: [] })
  })

  it('lists its categories with what each holds, and the newest albums', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    expect(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.songs, value: '3' }),
      }),
    ).toBeTruthy()
    // The songs are counted from a page of one; no catalogue is listed for a count.
    expect(mockApi.listTracks).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: '', limit: 1 })
    expect(mockApi.listArtists).not.toHaveBeenCalled()
    expect(mockApi.listAlbums).toHaveBeenCalledTimes(1)
    expect(mockApi.listAlbums).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: MUSIC.id, sort: MUSIC_SORTS.added }),
    )
    expect(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.albums, value: '1' }),
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.artists, value: '1' }),
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({
          label: LIBRARY_PAGE_COPY.downloads,
          value: LIBRARY_PAGE_COPY.noneYet,
        }),
      }),
    ).toBeTruthy()
    expect(screen.getByRole('header', { name: LIBRARY_PAGE_COPY.recent })).toBeTruthy()
    expect(await screen.findByRole('button', { name: ALBUM_TILE })).toBeTruthy()
  })

  it("lists raven's seven music tabs in raven's order, then Songs and Downloads, with their counts", async () => {
    keepSongs({ partway: [AIRBAG], finished: [LUCKY] })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await screen.findByRole('button', {
      name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.albums, value: '1' }),
    })
    const labels = LIBRARY_ORDER.map((segment) => LIBRARY_LABELS[segment])
    const rows = screen
      .getAllByRole('button')
      .map((row) => String(row.props.accessibilityLabel ?? ''))
      .flatMap((name) => labels.filter((label) => name === label || name.startsWith(`${label}, `)))
    expect(rows).toEqual(labels)
    expect(mockApi.getLibraryCounts).toHaveBeenCalledWith(MUSIC.id)
    expect(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.inProgress, value: '1' }),
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.finished, value: '1' }),
      }),
    ).toBeTruthy()
    // No album is unmatched, so that row says no zero.
    expect(screen.getByRole('button', { name: LIBRARY_PAGE_COPY.unmatchedAlbums })).toBeTruthy()
  })

  it('opens Albums from its row, and an album from there', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.albums, value: '1' }),
      }),
    )
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.albums })).toBeTruthy()
    expect(router.getPathname()).toBe(collectionPathOf(LIBRARY_SEGMENTS.albums))
    expect(mockApi.listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
    })
    expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.albums }))).toBeTruthy()

    await fireEvent.press(screen.getAllByRole('button', { name: ALBUM_TILE }).at(-1)!)
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it('finds albums by what is typed, and sorts them', async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums) })
    expect(await screen.findByRole('button', { name: ALBUM_TILE })).toBeTruthy()

    await fireEvent.changeText(
      screen.getByLabelText(LIBRARY_PAGE_COPY.searchAlbums),
      'nothing like it',
    )
    expect(await screen.findByText(LIBRARY_PAGE_COPY.noMatches)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: SORT_BUTTON }))
    await fireEvent.press(
      await screen.findByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.year] }),
    )
    expect(
      await screen.findByRole('button', {
        name: LIBRARY_PAGE_COPY.sortLabel(MUSIC_SORT_LABELS[MUSIC_SORTS.year]),
      }),
    ).toBeTruthy()
  })

  it("offers raven's sorts in raven's order and words, the one in use checked", async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums) })
    await fireEvent.press(await screen.findByRole('button', { name: SORT_BUTTON }))
    const options = await screen.findAllByRole('radio')
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual(
      Object.values(MUSIC_SORTS).map((sort) => MUSIC_SORT_LABELS[sort]),
    )
    expect(
      screen.getByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.title], checked: true }),
    ).toBeTruthy()
  })

  it('puts the albums in the order picked', async () => {
    mockApi.listAlbums.mockResolvedValue([OK_COMPUTER, AMNESIAC])
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums) })
    expect(await screen.findByText(AMNESIAC.title)).toBeTruthy()
    expect(shownTitles()).toEqual([AMNESIAC.title, OK_COMPUTER.title])

    await fireEvent.press(screen.getByRole('button', { name: SORT_BUTTON }))
    await fireEvent.press(
      await screen.findByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.year] }),
    )
    expect(shownTitles()).toEqual([OK_COMPUTER.title, AMNESIAC.title])
  })

  it('offers five cover sizes, the one in use checked, and keeps the one picked', async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums) })
    await fireEvent.press(await screen.findByRole('button', { name: COVER_SIZE_BUTTON }))
    const options = await screen.findAllByRole('radio')
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual(
      Object.values(COVER_SIZES).map((size) => LIBRARY_PAGE_COPY.coverSizes[size]),
    )
    expect(
      screen.getByRole('radio', {
        name: LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.medium],
        checked: true,
      }),
    ).toBeTruthy()

    await fireEvent.press(
      screen.getByRole('radio', { name: LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.large] }),
    )
    expect(useWrenPrefs.getState().coverSize).toBe(COVER_SIZES.large)
    expect(
      await screen.findByRole('button', {
        name: LIBRARY_PAGE_COPY.coverSizeLabel(LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.large]),
      }),
    ).toBeTruthy()
  })

  it('lists the artists, with the A to Z rail, and opens one', async () => {
    const router = await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.artists),
    })
    await fireEvent.press(await screen.findByRole('button', { name: RADIOHEAD.name }))
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it('shows the A to Z rail beside the artists', async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.artists) })
    expect(await screen.findByRole('button', { name: LIBRARY_PAGE_COPY.jumpTo('R') })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: LIBRARY_PAGE_COPY.jumpTo('R') }))
    expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.artists }))).toBeTruthy()
  })

  it("draws each artist as a card with what they hold, as raven's Artists tab does", async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.artists) })
    expect(await screen.findByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.getByText(countsLineOf({ albums: 1, tracks: 3 }))).toBeTruthy()
  })

  it('lists the albums no release was found for, from the same listing as Albums', async () => {
    const unmatched = { ...OK_COMPUTER, id: 8, title: 'Kid A', match: MATCH_STATES.unmatched }
    mockApi.listAlbums.mockResolvedValue([OK_COMPUTER, unmatched])
    await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.unmatchedAlbums),
    })
    expect(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: unmatched.title, value: RADIOHEAD.name }),
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: ALBUM_TILE })).toBeNull()
    expect(mockApi.listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
    })
    mockApi.listAlbums.mockResolvedValue([OK_COMPUTER])
  })

  it('says every album is matched when none is unmatched', async () => {
    await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.unmatchedAlbums),
    })
    expect(await screen.findByText(LIBRARY_PAGE_COPY.noUnmatchedAlbums)).toBeTruthy()
  })

  it('lists the songs this device left partway as their albums keep them, and plays from one', async () => {
    keepSongs({ partway: [PARANOID] })
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.inProgress) })
    await fireEvent.press(await screen.findByRole('button', { name: PARANOID.title }))
    expect(mockApi.listInProgress).not.toHaveBeenCalled()
    expect(mockApi.getAlbum).toHaveBeenCalledWith(OK_COMPUTER.id)
    expect(useAudioQueue.getState().queue.items).toHaveLength(1)
  })

  it('lists the favourite songs and the songs this device finished most recently', async () => {
    keepSongs({ finished: [LUCKY], partway: [PARANOID] })
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.favourites) })
    expect(await screen.findByRole('button', { name: AIRBAG.title })).toBeTruthy()
    expect(mockApi.listLibraryFavourites).toHaveBeenCalledWith(MUSIC.id)
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.finished) })
    expect(await screen.findByRole('button', { name: LUCKY.title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: PARANOID.title })).toBeNull()
    expect(mockApi.listHistory).not.toHaveBeenCalled()
  })

  it('says so when this device has left no song partway', async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.inProgress) })
    expect(await screen.findByText(LIBRARY_PAGE_COPY.noInProgress)).toBeTruthy()
  })

  it('says so when there are no favourites, with no Play to press', async () => {
    mockApi.listLibraryFavourites.mockResolvedValue([])
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.favourites) })
    expect(await screen.findByText(LIBRARY_PAGE_COPY.noFavourites)).toBeTruthy()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.play })).toBeNull()
    mockApi.listLibraryFavourites.mockResolvedValue(FAVOURITES)
  })

  it('lists the favourite artists above the favourite songs, each under its heading', async () => {
    mockApi.listFavouriteArtists.mockResolvedValue([RADIOHEAD])
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.favourites) })
    expect(await screen.findByRole('button', { name: AIRBAG.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.getByRole('header', { name: LIBRARY_PAGE_COPY.artists })).toBeTruthy()
    expect(screen.getByRole('header', { name: LIBRARY_PAGE_COPY.songs })).toBeTruthy()
    mockApi.listFavouriteArtists.mockResolvedValue([])
  })

  it('lists a favourite artist when there are no favourite songs', async () => {
    mockApi.listFavouriteArtists.mockResolvedValue([RADIOHEAD])
    mockApi.listLibraryFavourites.mockResolvedValue([])
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.favourites) })
    expect(await screen.findByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.queryByRole('header', { name: LIBRARY_PAGE_COPY.songs })).toBeNull()
    expect(screen.queryByText(LIBRARY_PAGE_COPY.noFavourites)).toBeNull()
    mockApi.listFavouriteArtists.mockResolvedValue([])
    mockApi.listLibraryFavourites.mockResolvedValue(FAVOURITES)
  })

  it('lists the favourite albums under their heading, with no notice', async () => {
    mockApi.listFavouriteAlbums.mockResolvedValue([OK_COMPUTER])
    mockApi.listLibraryFavourites.mockResolvedValue([])
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.favourites) })
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.albums })).toBeTruthy()
    expect(screen.getByText(OK_COMPUTER.title)).toBeTruthy()
    expect(screen.queryByText(LIBRARY_PAGE_COPY.noFavourites)).toBeNull()
    mockApi.listFavouriteAlbums.mockResolvedValue([])
    mockApi.listLibraryFavourites.mockResolvedValue(FAVOURITES)
  })

  it('lists the songs a page at a time, asking for the next page at the end of the list', async () => {
    mockApi.listTracks.mockImplementation(async ({ offset = 0 }) =>
      offset === 0
        ? { tracks: FIRST_PAGE, total: MUSIC_PAGE.most + 1 }
        : { tracks: [trackFor({ id: 9, title: 'Last song' })], total: MUSIC_PAGE.most + 1 },
    )
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.songs) })

    expect(await screen.findByRole('button', { name: 'Song 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.play })).toBeTruthy()
    expect(
      await screen.findByText(plural({ n: MUSIC_PAGE.most + 1, ...COUNTS_COPY.songs })),
    ).toBeTruthy()
    const pages = () =>
      mockApi.listTracks.mock.calls.filter(([props]) => props.limit === MUSIC_PAGE.most)
    expect(pages()).toHaveLength(1)
    expect(mockApi.listTracks).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
      seed: 0,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })

    await fireEvent(screen.getByTestId('songs'), 'endReached')
    expect(pages()).toHaveLength(2)
    expect(mockApi.listTracks).toHaveBeenLastCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
      seed: 0,
      limit: MUSIC_PAGE.most,
      offset: MUSIC_PAGE.most,
    })
  })

  it("lists the listener's playlists, and opens one", async () => {
    const router = await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.playlists),
    })
    await fireEvent.press(await screen.findByRole('button', { name: MIXTAPE.name }))
    expect(await screen.findByRole('header', { name: MIXTAPE.name })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.playlist, id: MIXTAPE.id }))
  })

  it('offers a first playlist when there is none, and makes it by name', async () => {
    mockApi.listPlaylists.mockResolvedValue([])
    mockApi.getPlaylist.mockResolvedValue(ROAD_TRIP)
    const router = await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.playlists),
    })
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.noPlaylists })).toBeTruthy()
    const [, emptyAction] = screen.getAllByRole('button', { name: NEW_PLAYLIST_COPY.title })
    await fireEvent.press(emptyAction!)

    await fireEvent.changeText(
      await screen.findByLabelText(NEW_PLAYLIST_COPY.name),
      ROAD_TRIP.playlist.name,
    )
    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))
    expect(mockApi.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.playlist.name })
    expect(await screen.findByRole('header', { name: ROAD_TRIP.playlist.name })).toBeTruthy()
    expect(router.getPathname()).toBe(
      pagePathOf({ page: WREN_PAGES.playlist, id: ROAD_TRIP.playlist.id }),
    )
    expect(useToast.getState().message).toBe(LIBRARY_PAGE_COPY.created(ROAD_TRIP.playlist.name))
  })
})
