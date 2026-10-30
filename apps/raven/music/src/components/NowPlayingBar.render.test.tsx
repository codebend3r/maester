import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { audioPlayer } from '@raven/audio'
import { MEDIA_TICKET_PARAM } from '@raven/core'
import type * as Native from '@raven/native'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@/session'
import { AIRBAG, LISTENER, PARANOID, musicApi } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  watchNetwork: () => () => undefined,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const BAR = 'Now Playing: Airbag, Radiohead'

describe('the now-playing bar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
  })

  it('stays away while nothing is queued', async () => {
    await renderRouter(WREN_TREE, { initialUrl: '/' })
    expect(await screen.findByRole('header', { name: 'Home' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: BAR })).toBeNull()
  })

  it('plays the queued track by its ticket, pauses it, and opens Now Playing without itself', async () => {
    await renderRouter(WREN_TREE, { initialUrl: '/' })
    await act(async () => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] }))
    await waitFor(() =>
      expect(audioPlayer.setWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          playing: expect.objectContaining({
            id: AIRBAG.id,
            uri: expect.stringContaining(`${MEDIA_TICKET_PARAM}=tkt.wren`),
          }),
          next: expect.objectContaining({ id: PARANOID.id }),
        }),
      ),
    )
    await act(async () => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))

    await fireEvent.press(await screen.findByRole('button', { name: 'Pause' }))
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.paused)

    await fireEvent.press(screen.getByRole('button', { name: BAR }))
    expect(await screen.findByRole('header', { name: 'Airbag' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: BAR })).toBeNull()
  })
})
