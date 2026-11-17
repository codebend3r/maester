import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { REPEAT_MODES, artistNames } from '@raven/core'
import type * as Native from '@raven/native'
import { RAVEN_SERVER } from '@raven/native/headless'
import { useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { NOW_PLAYING_COPY } from '@/screens/copy'
import { ROW_ACTIONS } from '@/screens/nowPlaying/QueueRow'
import { useWrenAccount } from '@/session'
import { PHONE_WINDOW } from '@/test/jestSetup'
import { AIRBAG, AUDIOBOOKS, LISTENER, PARANOID, musicApi, trackFor } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'
import { PLAYER_COPY } from '@/ui/copy'

const mockApi = musicApi()
const seekTo = jest.fn<ReturnType<typeof useAudioQueue.getState>['seekTo']>()
const move = jest.fn<ReturnType<typeof useAudioQueue.getState>['move']>()
const remove = jest.fn<ReturnType<typeof useAudioQueue.getState>['remove']>()
const jump = jest.fn<ReturnType<typeof useAudioQueue.getState>['jump']>()

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

const EXIT_MUSIC = trackFor({ id: 104, title: 'Exit Music', number: 4 })

// An 11 inch iPad's window, held sideways.
const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

type HeldWindow = typeof PHONE_WINDOW | typeof TABLET_WINDOW

const holdAs = (window: HeldWindow) => act(() => Dimensions.set({ window, screen: window }))

const openNowPlaying = () => renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.nowPlaying })

const rowNamed = (title: string) =>
  screen.getByRole('button', {
    name: NOW_PLAYING_COPY.entry({ title, line: artistNames(AIRBAG) }),
  })

const actionOf = (name: string) => ({ nativeEvent: { actionName: name } })

describe('Now Playing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
    usePlayerPrefs.getState().setAudiobookSpeed(1)
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, EXIT_MUSIC] })
    useAudioQueue.setState({ seekTo, move, remove, jump })
  })

  afterEach(() => holdAs(PHONE_WINDOW))

  it('shows the playing song, where it plays from, and where it plays', async () => {
    await openNowPlaying()
    expect(await screen.findByRole('header', { name: 'Airbag' })).toBeTruthy()
    expect(screen.getByText(NOW_PLAYING_COPY.from.other)).toBeTruthy()
    const output = NOW_PLAYING_COPY.output({
      server: RAVEN_SERVER.name,
      device: NOW_PLAYING_COPY.devices.iPhone,
    })
    expect(screen.getByRole('button', { name: output, selected: true })).toBeTruthy()
    expect(screen.getByRole('adjustable', { name: PLAYER_COPY.position })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: NOW_PLAYING_COPY.speedOf(1.5) })).toBeNull()
  })

  it('cycles repeat through its modes, named for each', async () => {
    await openNowPlaying()
    await fireEvent.press(
      await screen.findByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] }),
    )
    expect(screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.all] })).toBeTruthy()
  })

  it('shows the lyrics, and seeks to a synced line that is tapped', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.lyrics }))
    const line = await screen.findByRole('button', { name: 'In a jackknifed juggernaut' })
    await fireEvent.press(line)
    expect(seekTo).toHaveBeenCalledWith(12)
    expect(screen.getByRole('button', { name: NOW_PLAYING_COPY.instrumental })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.lyrics }))
    expect(screen.queryByRole('button', { name: 'In a jackknifed juggernaut' })).toBeNull()
  })

  it('says when a song has no lyrics', async () => {
    useAudioQueue.getState().playTracks({ tracks: [PARANOID] })
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.lyrics }))
    expect(await screen.findByText(NOW_PLAYING_COPY.noLyrics)).toBeTruthy()
  })

  it('lists what plays next, which plays, moves and goes through its actions', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.upNext }))
    expect(await screen.findByRole('header', { name: PLAYER_COPY.upNext })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Airbag, / })).toBeNull()
    await fireEvent.press(rowNamed('Exit Music'))
    expect(jump).toHaveBeenCalledWith(2)
    await fireEvent(
      rowNamed('Paranoid Android'),
      'accessibilityAction',
      actionOf(ROW_ACTIONS.moveDown),
    )
    expect(move).toHaveBeenCalledWith({ from: 1, to: 2 })
    await fireEvent(rowNamed('Exit Music'), 'accessibilityAction', actionOf(ROW_ACTIONS.moveUp))
    expect(move).toHaveBeenCalledWith({ from: 2, to: 1 })
    await fireEvent(
      rowNamed('Paranoid Android'),
      'accessibilityAction',
      actionOf(ROW_ACTIONS.remove),
    )
    expect(remove).toHaveBeenCalledWith(1)
  })

  it('lays the player, the lyrics and Up next side by side on a tablet', async () => {
    await holdAs(TABLET_WINDOW)
    await openNowPlaying()
    expect(await screen.findByRole('header', { name: 'Airbag' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'In a jackknifed juggernaut' })).toBeTruthy()
    expect(screen.getByRole('header', { name: PLAYER_COPY.upNext })).toBeTruthy()
    expect(screen.getByText(NOW_PLAYING_COPY.playingOn(NOW_PLAYING_COPY.devices.iPad))).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: NOW_PLAYING_COPY.clearLabel }))
    expect(remove.mock.calls).toEqual([[2], [1]])
  })

  it("offers an audiobook's speed, and sets it", async () => {
    mockApi.listLibraries.mockResolvedValue([AUDIOBOOKS])
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('radio', { name: NOW_PLAYING_COPY.speedOf(1.5) }))
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
  })
})
