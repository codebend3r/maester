import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import type * as Native from '@raven/native'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@/session'
import { LISTENER, MIXTAPE, MIXTAPE_PAGE, musicApi } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()

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

describe('Playlist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks })
  })

  it("lists the playlist's tracks in its order, and plays it from the top or a track", async () => {
    await renderRouter(WREN_TREE, { initialUrl: `/playlist/${MIXTAPE.id}` })
    expect(await screen.findByRole('header', { name: MIXTAPE.name })).toBeTruthy()
    expect(screen.getByText('2 tracks · 10 min')).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: /^\d\. / }).map((row) => row.props.accessibilityLabel),
    ).toEqual(['1. Lucky', '2. Airbag'])

    const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: MIXTAPE.id }
    await fireEvent.press(screen.getByRole('button', { name: 'Play' }))
    expect(playTracks).toHaveBeenCalledWith({ tracks: MIXTAPE_PAGE.tracks, source })
    await fireEvent.press(screen.getByRole('button', { name: '2. Airbag' }))
    expect(playTracks).toHaveBeenLastCalledWith({ tracks: MIXTAPE_PAGE.tracks, startAt: 1, source })
  })

  it('says when the playlist is empty', async () => {
    mockApi.getPlaylist.mockResolvedValue({ playlist: { ...MIXTAPE, trackCount: 0 }, tracks: [] })
    await renderRouter(WREN_TREE, { initialUrl: `/playlist/${MIXTAPE.id}` })
    expect(
      await screen.findByText("Nothing in Mixtape yet. Add songs from any track's menu."),
    ).toBeTruthy()
  })
})
