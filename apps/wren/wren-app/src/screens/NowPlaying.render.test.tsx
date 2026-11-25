import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { REPEAT_MODES, TRACK_STREAM_KINDS, artistNames } from '@raven/core'
import type * as Native from '@raven/native'
import { RAVEN_SERVER } from '@raven/native/headless'
import { useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import { KIT_COPY, NOW_PLAYING_COPY, PLAYER_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { ROW_ACTIONS } from '@/screens/nowPlaying/QueueRow'
import { useWrenAccount } from '@/session'
import { usePlayedStreams } from '@raven/native/headless'
import { PHONE_WINDOW } from '@/test/jestSetup'
import { AIRBAG, AUDIOBOOKS, LISTENER, PARANOID, musicApi, trackFor } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

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
    usePlayedStreams.setState({ streams: {} })
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, EXIT_MUSIC] })
    // Clearing the queue keeps its repeat mode, as it does for a listener.
    useAudioQueue.setState(({ queue }) => ({
      queue: { ...queue, repeat: REPEAT_MODES.off },
      seekTo,
      move,
      remove,
      jump,
    }))
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

  it("draws the file's format and bit depth as chips once the host has a source for it", async () => {
    usePlayedStreams.getState().heard({
      trackId: AIRBAG.id,
      stream: { kind: TRACK_STREAM_KINDS.file },
    })
    await openNowPlaying()
    expect(
      await screen.findByLabelText(
        KIT_COPY.labelled({
          label: NOW_PLAYING_COPY.quality,
          value: 'FLAC · 16-bit / 44.1 kHz · 900 kbps',
        }),
      ),
    ).toBeTruthy()
    expect(screen.getByText('FLAC')).toBeTruthy()
    expect(screen.getByText('16-bit')).toBeTruthy()
    expect(screen.getByText('44.1 kHz · 900 kbps')).toBeTruthy()
  })

  it('keeps Previous, Play or Pause and Next alone under the scrubber', async () => {
    await openNowPlaying()
    expect(await screen.findByRole('button', { name: PLAYER_COPY.previous })).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.next })).toBeTruthy()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.shuffle })).toBeNull()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] })).toBeNull()
  })

  it('shows the time played and the time left, with a minus, under the scrubber', async () => {
    useAudioQueue.setState({ position: 62, duration: 300 })
    await openNowPlaying()
    expect(await screen.findByText('1:02', { includeHiddenElements: true })).toBeTruthy()
    expect(screen.getByText('-3:58', { includeHiddenElements: true })).toBeTruthy()
  })

  it('turns the song off as a favourite from the heart beside its name', async () => {
    await openNowPlaying()
    const heart = await screen.findByRole('button', {
      name: TRACK_MENU_COPY.likeSong(AIRBAG.title),
      selected: true,
    })
    await fireEvent.press(heart)
    expect(mockApi.setFavourite).toHaveBeenCalledWith({ id: AIRBAG.id, favourite: false })
  })

  it("opens the listener's playlists from Add to playlist beside the song's name", async () => {
    await openNowPlaying()
    await fireEvent.press(
      await screen.findByRole('button', { name: NOW_PLAYING_COPY.addToPlaylist }),
    )
    expect(
      await screen.findByRole('header', { name: TRACK_MENU_COPY.addToPlaylistTitle }),
    ).toBeTruthy()
    expect(screen.queryByText(TRACK_MENU_COPY.playNext)).toBeNull()
  })

  it('shuffles, repeats and clears the queue from Up next', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.upNext }))
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
    await fireEvent.press(
      screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] }),
    )
    expect(screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.all] })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: NOW_PLAYING_COPY.clearLabel }))
    expect(remove).toHaveBeenCalledTimes(2)
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

  it('lays the player beside a pane that opens on Up next, on a tablet', async () => {
    await holdAs(TABLET_WINDOW)
    await openNowPlaying()
    expect(await screen.findByRole('header', { name: 'Airbag' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: PLAYER_COPY.upNext, checked: true })).toBeTruthy()
    expect(screen.getByRole('header', { name: PLAYER_COPY.upNext })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'In a jackknifed juggernaut' })).toBeNull()
    expect(screen.getByText(NOW_PLAYING_COPY.playingOn(NOW_PLAYING_COPY.devices.iPad))).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.shuffle })).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: NOW_PLAYING_COPY.clearLabel }))
    expect(remove.mock.calls).toEqual([[2], [1]])
  })

  it("swaps the tablet's pane for the lyrics from its tabs", async () => {
    await holdAs(TABLET_WINDOW)
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('radio', { name: PLAYER_COPY.lyrics }))
    expect(await screen.findByRole('button', { name: 'In a jackknifed juggernaut' })).toBeTruthy()
    expect(screen.queryByRole('header', { name: PLAYER_COPY.upNext })).toBeNull()
    expect(screen.getByRole('adjustable', { name: PLAYER_COPY.position })).toBeTruthy()
  })

  it("offers an audiobook's speed, and sets it", async () => {
    mockApi.listLibraries.mockResolvedValue([AUDIOBOOKS])
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('radio', { name: NOW_PLAYING_COPY.speedOf(1.5) }))
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
  })
})
