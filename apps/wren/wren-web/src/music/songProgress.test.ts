import { afterEach, describe, expect, it } from 'bun:test'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { SONG_PROGRESS_KEY } from '@raven/wren'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { clearAccountState } from '@/lib/clearAccountState'
import { serverAddress } from '@/lib/serverAddress'
import { deviceSpotOf, useKeepSongProgress } from '@/music/songProgress'
import { useSongProgress } from '@/stores/songProgress'
import { AIRBAG, LUCKY } from '@/test/music'

const queue = () => useAudioQueue.getState()

const songs = () => useSongProgress.getState().songs

/** What the browser kept, as localStorage holds it. */
const kept = (): string => window.localStorage.getItem(SONG_PROGRESS_KEY) ?? ''

type PlayToProps = { position: number }

const playTo = ({ position }: PlayToProps) =>
  act(() => queue().engine.time({ position, duration: AIRBAG.duration }))

describe('useKeepSongProgress', () => {
  afterEach(() => {
    cleanup()
    act(() => queue().clear())
    useSongProgress.getState().clear()
  })

  it('keeps a song left partway in this browser, and starts it there again', () => {
    renderHook(() => useKeepSongProgress())
    act(() => queue().playTracks({ tracks: [AIRBAG, LUCKY] }))
    act(() => queue().engine.state(AUDIO_STATES.playing))
    playTo({ position: 30 })
    playTo({ position: 42 })
    act(() => queue().next())
    expect(songs().map(({ trackId, left }) => [trackId, left?.position])).toEqual([[AIRBAG.id, 42]])
    expect(kept()).toContain('"position":42')
    expect(deviceSpotOf(AIRBAG)).toBe(42)
    expect(deviceSpotOf(LUCKY)).toBeNull()
  })

  it('keeps the exact spot as the page goes, between the saves made while it plays', () => {
    renderHook(() => useKeepSongProgress())
    act(() => queue().playTracks({ tracks: [AIRBAG] }))
    act(() => queue().engine.state(AUDIO_STATES.playing))
    playTo({ position: 30 })
    playTo({ position: 33 })
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(deviceSpotOf(AIRBAG)).toBe(33)
  })

  it('keeps a song played to its end as finished, partway no more', () => {
    renderHook(() => useKeepSongProgress())
    act(() => queue().playTracks({ tracks: [AIRBAG] }))
    act(() => queue().engine.state(AUDIO_STATES.playing))
    playTo({ position: 200 })
    playTo({ position: 299 })
    expect(songs()).toEqual([
      expect.objectContaining({ serverId: serverAddress(), trackId: AIRBAG.id, left: null }),
    ])
    expect(songs()[0]?.finishedAt).not.toBeNull()
    expect(deviceSpotOf(AIRBAG)).toBeNull()
  })

  it('is forgotten with the rest of what an account leaves', async () => {
    useSongProgress.getState().note({ serverId: serverAddress(), track: AIRBAG, position: 60 })
    await clearAccountState({ queryClient: new QueryClient() })
    expect(songs()).toEqual([])
  })
})
