import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { audioPlayer } from '@raven/audio'
import { MEDIA_TICKET_PARAM } from '@raven/core'
import type * as Native from '@raven/native'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { LIBRARY_PAGE_COPY, PLAYER_COPY, scrubTextOf } from '@raven/wren'
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@/session'
import { PHONE_WINDOW } from '@/test/jestSetup'
import { AIRBAG, LISTENER, PARANOID, musicApi } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  // jest has no NetInfo native module to ask; the device is on Wi-Fi.
  isOnCellular: async () => false,
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

// An 11 inch iPad's window, held sideways.
const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

const holdAs = (window: typeof PHONE_WINDOW | typeof TABLET_WINDOW) =>
  act(() => Dimensions.set({ window, screen: window }))

describe('the now-playing bar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
  })

  afterEach(() => holdAs(PHONE_WINDOW))

  it('stays away while nothing is queued', async () => {
    await renderRouter(WREN_TREE, { initialUrl: '/' })
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.recent })).toBeTruthy()
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

  it("draws the tablet's bar from Now Playing's transport and scrubber", async () => {
    await holdAs(TABLET_WINDOW)
    await renderRouter(WREN_TREE, { initialUrl: '/' })
    await act(async () => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] }))
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.next }))
    expect(useAudioQueue.getState().queue.at).toBe(1)
    expect(screen.getByRole('button', { name: PLAYER_COPY.previous })).toBeTruthy()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.shuffle })).toBeNull()
    const scrubber = screen.getByRole('adjustable', { name: PLAYER_COPY.position })
    expect(scrubber.props.accessibilityValue).toEqual(
      expect.objectContaining({
        text: scrubTextOf({ position: 0, length: PARANOID.duration ?? 0 }),
      }),
    )
  })
})
