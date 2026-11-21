import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_PAGE, MUSIC_SORTS, type PlaylistDetails, plural } from '@raven/core'
import type * as Native from '@raven/native'
import {
  COUNTS_COPY,
  KIT_COPY,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  LIST_SORT_LABELS,
  LIST_SORTS,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
} from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { WREN_PAGES, WREN_ROUTES, collectionPathOf } from '@/routes'
import { useWrenAccount } from '@/session'
import { useToast } from '@/stores/toast'
import { LISTENER, MIXTAPE, MUSIC, OK_COMPUTER, RADIOHEAD, musicApi, trackFor } from '@/test/music'
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

describe('Library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
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
    expect(screen.getByRole('button', { name: LIBRARY_PAGE_COPY.albums })).toBeTruthy()
    expect(screen.getByRole('button', { name: LIBRARY_PAGE_COPY.artists })).toBeTruthy()
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

  it('opens Albums from its row, and an album from there', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(await screen.findByRole('button', { name: LIBRARY_PAGE_COPY.albums }))
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

    await fireEvent.press(
      screen.getByRole('button', {
        name: LIBRARY_PAGE_COPY.sortLabel(LIST_SORT_LABELS[LIST_SORTS.title]),
      }),
    )
    await fireEvent.press(
      await screen.findByRole('radio', { name: LIST_SORT_LABELS[LIST_SORTS.year] }),
    )
    expect(
      await screen.findByRole('button', {
        name: LIBRARY_PAGE_COPY.sortLabel(LIST_SORT_LABELS[LIST_SORTS.year]),
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
      limit: MUSIC_PAGE.most,
      offset: 0,
    })

    await fireEvent(screen.getByTestId('songs'), 'endReached')
    expect(pages()).toHaveLength(2)
    expect(mockApi.listTracks).toHaveBeenLastCalledWith({
      libraryId: MUSIC.id,
      search: '',
      sort: MUSIC_SORTS.title,
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
