import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import type * as Native from '@raven/native'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import { TRACK_MENU_COPY } from '@/components/copy'
import { queryClient } from '@/queryClient'
import { WREN_PAGES } from '@/routes'
import { ARTIST_COPY, DETAIL_COPY } from '@/screens/copy'
import { useWrenAccount } from '@/session'
import { PHONE_WINDOW } from '@/test/jestSetup'
import { LISTENER, OK_COMPUTER, OK_COMPUTER_PAGE, RADIOHEAD, musicApi } from '@/test/music'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'
import { PLAYER_COPY, KIT_COPY } from '@/ui/copy'

const mockApi = { ...musicApi(), artistPhotoUrl: (): string | null => null }
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()
const addToQueue = jest.fn<ReturnType<typeof useAudioQueue.getState>['addToQueue']>()

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

const ARTIST_URL = pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id })

const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

const OK_COMPUTER_TILE = KIT_COPY.labelled({ label: OK_COMPUTER.title, value: RADIOHEAD.name })

describe('Artist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks, addToQueue })
  })

  afterEach(() => {
    Dimensions.set({ window: PHONE_WINDOW, screen: PHONE_WINDOW })
  })

  it('names the artist with their counts, follows them, and opens one of their albums', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: ARTIST_URL })
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.getByText('1 album · 3 songs')).toBeTruthy()
    expect(screen.getByRole('header', { name: ARTIST_COPY.albums })).toBeTruthy()
    expect(screen.queryByRole('header', { name: ARTIST_COPY.appearsOn })).toBeNull()

    await fireEvent.press(screen.getByRole('switch', { name: PLAYER_COPY.follow }))
    expect(mockApi.setArtistFavourite).toHaveBeenCalledWith({
      artistId: RADIOHEAD.id,
      favourite: true,
    })

    await fireEvent.press(screen.getByRole('button', { name: OK_COMPUTER_TILE }))
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it("plays and shuffles the artist's albums, read as they are asked for", async () => {
    await renderRouter(WREN_TREE, { initialUrl: ARTIST_URL })
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.play }))
    const source = { kind: QUEUE_SOURCE_KINDS.artist, id: RADIOHEAD.id }
    await waitFor(() =>
      expect(playTracks).toHaveBeenCalledWith({
        tracks: OK_COMPUTER_PAGE.tracks,
        source,
        isShuffled: false,
      }),
    )
    expect(mockApi.getAlbum).toHaveBeenCalledWith(OK_COMPUTER.id)

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    await waitFor(() =>
      expect(playTracks).toHaveBeenLastCalledWith({
        tracks: OK_COMPUTER_PAGE.tracks,
        source,
        isShuffled: true,
      }),
    )
  })

  it("adds the artist's songs to the queue from More", async () => {
    await renderRouter(WREN_TREE, { initialUrl: ARTIST_URL })
    await fireEvent.press(await screen.findByRole('button', { name: DETAIL_COPY.more }))
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks))
  })

  it('draws the hero and the albums on a tablet', async () => {
    Dimensions.set({ window: TABLET_WINDOW, screen: TABLET_WINDOW })
    await renderRouter(WREN_TREE, { initialUrl: ARTIST_URL })
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.play })).toBeTruthy()
    expect(screen.getByRole('button', { name: OK_COMPUTER_TILE })).toBeTruthy()
  })
})
