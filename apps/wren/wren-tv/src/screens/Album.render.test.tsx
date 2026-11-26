import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { type PlaylistDetails, type PlaylistInput, QUEUE_SOURCE_KINDS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { ALBUM_COPY, KIT_COPY, NEW_PLAYLIST_COPY, PLAYER_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_PAGES } from '@raven/wren-native/headless'
import {
  AIRBAG,
  LISTENER,
  LUCKY,
  MIXTAPE,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  RADIOHEAD,
  musicApi,
} from '@/test/music'
import type * as NativeMock from '@/test/nativeMock'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const ROAD_TRIP = { ...MIXTAPE, id: MIXTAPE.id + 10, name: 'Road trip', trackCount: 0, duration: 0 }

const mockApi = {
  ...musicApi(),
  createPlaylist: jest.fn(async (_input: PlaylistInput): Promise<PlaylistDetails> => ({
    playlist: ROAD_TRIP,
    tracks: [],
  })),
  artistPhotoUrl: (): string | null => null,
}
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()
const playNext = jest.fn<ReturnType<typeof useAudioQueue.getState>['playNext']>()
const addToQueue = jest.fn<ReturnType<typeof useAudioQueue.getState>['addToQueue']>()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () =>
  jest.requireActual<typeof NativeMock>('@/test/nativeMock').nativeModuleMock({
    apiOf: () => mockApi,
  }),
)

const ALBUM_URL = pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id })

const SOURCE = { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id }

/** Opens Airbag's menu from its More, then Add to playlist. */
const openAddToPlaylist = async () => {
  await fireEvent.press(await screen.findByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
  await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))
}

describe('Album', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks, playNext, addToQueue })
  })

  it('lists the tracks under each disc in order, and plays the album from the top', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })

    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(screen.getByText('1997 · 3 songs · 15 min')).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Disc 1' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Disc 2' })).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: /^\d\. / }).map((row) => row.props.accessibilityLabel),
    ).toEqual(['1. Airbag', '2. Paranoid Android', '3. Lucky'])

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.play }))
    expect(playTracks).toHaveBeenCalledWith({ tracks: OK_COMPUTER_PAGE.tracks, source: SOURCE })
  })

  it('plays from the track pressed, and shuffles the album', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: '2. Paranoid Android' }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      startAt: 1,
      source: SOURCE,
    })

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      source: SOURCE,
      isShuffled: true,
    })
  })

  it('queues the album and likes it', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.queue }))
    expect(addToQueue).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks)
    expect(await screen.findByText(ALBUM_COPY.queued(OK_COMPUTER.title))).toBeTruthy()

    await fireEvent.press(screen.getByRole('switch', { name: PLAYER_COPY.like }))
    expect(mockApi.setAlbumFavourite).toHaveBeenCalledWith({
      albumId: OK_COMPUTER.id,
      favourite: true,
    })
  })

  it('opens the artist from their name under the title', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(
      await screen.findByRole('link', { name: ALBUM_COPY.openArtist(RADIOHEAD.name) }),
    )
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it("puts a held row's track next or at the end of the queue from its menu", async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    const airbag = await screen.findByRole('button', { name: '1. Airbag' })

    await fireEvent(airbag, 'longPress')
    expect(await screen.findByText(`${RADIOHEAD.name} · ${OK_COMPUTER.title}`)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith([AIRBAG])

    await fireEvent(airbag, 'longPress')
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    expect(addToQueue).toHaveBeenCalledWith([AIRBAG])
  })

  it('unlikes a liked song from its menu, and likes one that is not', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent(await screen.findByRole('button', { name: '1. Airbag' }), 'longPress')
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.unlike }))
    expect(mockApi.setFavourite).toHaveBeenCalledWith({ id: AIRBAG.id, favourite: false })

    await fireEvent(screen.getByRole('button', { name: '3. Lucky' }), 'longPress')
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.like }))
    expect(mockApi.setFavourite).toHaveBeenLastCalledWith({ id: LUCKY.id, favourite: true })
  })

  it("goes to a track's artist from its menu", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.goToArtist }))
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it('adds a track to a playlist, and says so in a toast', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await openAddToPlaylist()
    await fireEvent.press(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: MIXTAPE.name, value: '2 songs' }),
      }),
    )

    expect(await screen.findByText(TRACK_MENU_COPY.added(MIXTAPE.name))).toBeTruthy()
    expect(mockApi.appendPlaylistTracks).toHaveBeenCalledWith({
      id: MIXTAPE.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it('makes a new playlist in the menu and puts the track in it', async () => {
    mockApi.listPlaylists.mockResolvedValueOnce([])
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await openAddToPlaylist()
    expect(await screen.findByText(TRACK_MENU_COPY.noPlaylists)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.title }))
    await fireEvent.changeText(await screen.findByLabelText(NEW_PLAYLIST_COPY.name), ROAD_TRIP.name)
    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))

    expect(await screen.findByText(TRACK_MENU_COPY.added(ROAD_TRIP.name))).toBeTruthy()
    expect(mockApi.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.name })
  })

  it('offers no Download, since a TV keeps no downloads', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await screen.findByRole('header', { name: OK_COMPUTER.title })
    expect(screen.queryByText(/Download/)).toBeNull()
  })
})
