import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@/session'
import { AIRBAG, AUDIOBOOKS, LISTENER, PARANOID, musicApi } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()
const seekTo = jest.fn<ReturnType<typeof useAudioQueue.getState>['seekTo']>()
const move = jest.fn<ReturnType<typeof useAudioQueue.getState>['move']>()
const remove = jest.fn<ReturnType<typeof useAudioQueue.getState>['remove']>()

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

const openNowPlaying = () => renderRouter(WREN_TREE, { initialUrl: '/now-playing' })

describe('Now Playing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
    usePlayerPrefs.getState().setAudiobookSpeed(1)
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] })
    useAudioQueue.setState({ seekTo, move, remove })
  })

  it('shows the playing track, and seeks to a synced line that is tapped', async () => {
    await openNowPlaying()
    expect(await screen.findByRole('header', { name: 'Airbag' })).toBeTruthy()
    const line = await screen.findByRole('button', { name: 'In a jackknifed juggernaut' })
    await fireEvent.press(line)
    expect(seekTo).toHaveBeenCalledWith(12)
    expect(screen.getByRole('button', { name: '♪' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: '1.5×' })).toBeNull()
  })

  it('moves a queued track up, and removes one', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('tab', { name: 'Queue' }))
    expect(screen.queryByRole('button', { name: 'Move Airbag up' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Move Paranoid Android up' }))
    expect(move).toHaveBeenCalledWith({ from: 1, to: 0 })
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Airbag' }))
    expect(remove).toHaveBeenCalledWith(0)
  })

  it('says quietly when a track has no lyrics', async () => {
    useAudioQueue.getState().playTracks({ tracks: [PARANOID] })
    await openNowPlaying()
    expect(await screen.findByText('No lyrics for this track.')).toBeTruthy()
  })

  it("offers an audiobook's speed, and sets it", async () => {
    mockApi.listLibraries.mockResolvedValue([AUDIOBOOKS])
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('tab', { name: '1.5×' }))
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
  })
})
