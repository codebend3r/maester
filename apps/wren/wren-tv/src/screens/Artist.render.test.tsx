import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { ARTIST_COPY, DETAIL_COPY, KIT_COPY, PLAYER_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_PAGES } from '@raven/wren-native/headless'
import { LISTENER, OK_COMPUTER, OK_COMPUTER_PAGE, RADIOHEAD, musicApi } from '@/test/music'
import type * as NativeMock from '@/test/nativeMock'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = { ...musicApi(), artistPhotoUrl: (): string | null => null }
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()
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

const ARTIST_URL = pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id })

const SOURCE = { kind: QUEUE_SOURCE_KINDS.artist, id: RADIOHEAD.id }

describe('Artist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks, addToQueue })
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

    await fireEvent.press(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({ label: OK_COMPUTER.title, value: String(OK_COMPUTER.year) }),
      }),
    )
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it("plays and shuffles the artist's albums, read as they are asked for", async () => {
    await renderRouter(WREN_TREE, { initialUrl: ARTIST_URL })
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.play }))
    await waitFor(() =>
      expect(playTracks).toHaveBeenCalledWith({
        tracks: OK_COMPUTER_PAGE.tracks,
        source: SOURCE,
      }),
    )
    expect(mockApi.getAlbum).toHaveBeenCalledWith(OK_COMPUTER.id)

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    await waitFor(() =>
      expect(playTracks).toHaveBeenLastCalledWith({
        tracks: OK_COMPUTER_PAGE.tracks,
        source: SOURCE,
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
})
