import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { REPEAT_MODES, TRACK_STREAM_KINDS, artistNames } from '@raven/core'
import { usePlayedStreams } from '@raven/native/headless'
import { AUDIO_STATES, useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { KIT_COPY, NOW_PLAYING_COPY, PLAYER_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'

import { queryClient } from '@/queryClient'
import { AIRBAG, LISTENER, PARANOID, musicApi, trackFor } from '@raven/wren-native/testing'
import type * as NativeMock from '@/test/nativeMock'
import { WREN_TREE } from '@/test/wrenTree'

type AudioQueue = ReturnType<typeof useAudioQueue.getState>

const mockApi = musicApi()
const seekTo = jest.fn<AudioQueue['seekTo']>()
const move = jest.fn<AudioQueue['move']>()
const remove = jest.fn<AudioQueue['remove']>()
const jump = jest.fn<AudioQueue['jump']>()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () =>
  jest.requireActual<typeof NativeMock>('@/test/nativeMock').nativeModuleMock({
    apiOf: () => mockApi,
  }),
)

// The second synced line of Airbag's lyrics, sung from 12 seconds in.
const AIRBAG_LYRICS_LINE = 'In a jackknifed juggernaut'

const EXIT_MUSIC = trackFor({ id: 104, title: 'Exit Music', number: 4 })

const openNowPlaying = () => renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.nowPlaying })

const rowNamed = (title: string) =>
  screen.getByRole('button', {
    name: NOW_PLAYING_COPY.entry({ title, line: artistNames(AIRBAG) }),
  })

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

  it('shows the playing song, where it plays from, the scrubber and the transport', async () => {
    await openNowPlaying()
    expect(await screen.findByRole('header', { name: AIRBAG.title })).toBeTruthy()
    expect(screen.getByText(NOW_PLAYING_COPY.from.other)).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.position })).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.previous })).toBeTruthy()
    expect(screen.getByRole('button', { name: PLAYER_COPY.next })).toBeTruthy()
    // Shuffle and Repeat sit in the transport's row and again in Up next's head.
    expect(screen.getAllByRole('button', { name: PLAYER_COPY.shuffle })).toHaveLength(2)
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
  })

  it('shows the time played and the time left, with a minus, under the scrubber', async () => {
    useAudioQueue.setState({ position: 62, duration: 300 })
    await openNowPlaying()
    expect(await screen.findByText('1:02', { includeHiddenElements: true })).toBeTruthy()
    expect(screen.getByText('-3:58', { includeHiddenElements: true })).toBeTruthy()
  })

  it('plays and pauses from the transport', async () => {
    useAudioQueue.getState().engine.state(AUDIO_STATES.playing)
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('button', { name: PLAYER_COPY.pause }))
    expect(useAudioQueue.getState().shouldPlay).toBe(false)
  })

  it('turns the song off as a favourite from the heart beside its name', async () => {
    await openNowPlaying()
    const heart = await screen.findByRole('switch', {
      name: TRACK_MENU_COPY.likeSong(AIRBAG.title),
      checked: true,
    })
    await fireEvent.press(heart)
    expect(mockApi.setFavourite).toHaveBeenCalledWith({ id: AIRBAG.id, favourite: false })
  })

  it("opens the listener's playlists from Add to playlist beside the song's name", async () => {
    await openNowPlaying()
    await fireEvent.press(
      await screen.findByRole('button', { name: NOW_PLAYING_COPY.addToPlaylist }),
    )
    expect(await screen.findByText(TRACK_MENU_COPY.addToPlaylistTitle)).toBeTruthy()
  })

  it('opens on Up next, whose songs play on a press and move or go through their More', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByText(PARANOID.title))
    expect(jump).toHaveBeenCalledWith(1)

    await fireEvent.press(screen.getByRole('button', { name: KIT_COPY.more(EXIT_MUSIC.title) }))
    await fireEvent.press(await screen.findByRole('button', { name: NOW_PLAYING_COPY.moveUp }))
    expect(move).toHaveBeenCalledWith({ from: 2, to: 1 })
    expect(screen.queryByRole('button', { name: NOW_PLAYING_COPY.moveDown })).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: KIT_COPY.more(PARANOID.title) }))
    await fireEvent.press(await screen.findByRole('button', { name: NOW_PLAYING_COPY.remove }))
    expect(remove).toHaveBeenCalledWith(1)
    expect(rowNamed(EXIT_MUSIC.title)).toBeTruthy()
  })

  it('clears every song still to play', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('button', { name: NOW_PLAYING_COPY.clearLabel }))
    expect(remove.mock.calls).toEqual([[2], [1]])
  })

  it('moves Repeat from off to all', async () => {
    await openNowPlaying()
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] }))[0]!,
    )
    expect(useAudioQueue.getState().queue.repeat).toBe(REPEAT_MODES.all)
  })

  it('shows the lyrics in their tab, and plays from a synced line pressed', async () => {
    await openNowPlaying()
    await fireEvent.press(await screen.findByRole('tab', { name: PLAYER_COPY.lyrics }))
    await fireEvent.press(await screen.findByRole('button', { name: AIRBAG_LYRICS_LINE }))
    expect(seekTo).toHaveBeenCalledWith(12)
  })

  it('says nothing is playing with an empty queue', async () => {
    useAudioQueue.getState().clear()
    await openNowPlaying()
    expect(await screen.findByText(NOW_PLAYING_COPY.nothing)).toBeTruthy()
  })
})
