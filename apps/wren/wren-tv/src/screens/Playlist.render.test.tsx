import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, PLAYLIST_COPY } from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_PAGES } from '@raven/wren-native/headless'
import { LISTENER, MIXTAPE, MIXTAPE_PAGE, musicApi } from '@raven/wren-native/testing'
import type * as NativeMock from '@/test/nativeMock'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()
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

const PLAYLIST_URL = pagePathOf({ page: WREN_PAGES.playlist, id: MIXTAPE.id })

describe('Playlist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks, addToQueue })
  })

  it("lists the playlist's tracks in its order, and plays it from the top or a track", async () => {
    await renderRouter(WREN_TREE, { initialUrl: PLAYLIST_URL })
    expect(await screen.findByRole('header', { name: MIXTAPE.name })).toBeTruthy()
    expect(screen.getByText('2 songs · 10 min')).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: /^\d\. / }).map((row) => row.props.accessibilityLabel),
    ).toEqual(['1. Lucky', '2. Airbag'])

    const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: MIXTAPE.id }
    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.play }))
    expect(playTracks).toHaveBeenCalledWith({ tracks: MIXTAPE_PAGE.tracks, source })
    await fireEvent.press(screen.getByRole('button', { name: '2. Airbag' }))
    expect(playTracks).toHaveBeenLastCalledWith({ tracks: MIXTAPE_PAGE.tracks, startAt: 1, source })
  })

  it('queues the playlist, and says so', async () => {
    await renderRouter(WREN_TREE, { initialUrl: PLAYLIST_URL })
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.queue }))
    expect(addToQueue).toHaveBeenCalledWith(MIXTAPE_PAGE.tracks)
    expect(await screen.findByText(PLAYLIST_COPY.queued(MIXTAPE.name))).toBeTruthy()
  })

  it('says when the playlist is empty, and offers nothing to play', async () => {
    mockApi.getPlaylist.mockResolvedValue({ playlist: { ...MIXTAPE, trackCount: 0 }, tracks: [] })
    await renderRouter(WREN_TREE, { initialUrl: PLAYLIST_URL })
    expect(await screen.findByText(PLAYLIST_COPY.empty(MIXTAPE.name))).toBeTruthy()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.play })).toBeNull()
  })
})
