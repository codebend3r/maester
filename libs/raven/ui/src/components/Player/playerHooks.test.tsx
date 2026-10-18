import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PLAYBACK_MODES } from '@raven/core'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PLAYBACK_STATUSES, usePlaybackLadder } from '@/components/Player/usePlaybackLadder'
import { initialVideoState, videoReducer } from '@/components/Player/useVideoState'
import { api } from '@/test/api'
import { playerQueryKeys as queryKeys } from '@/lib/playerQueryKeys'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE } from '@/test/render'

describe('videoReducer', () => {
  it('starts paused at the resume point, and follows the element', () => {
    const start = initialVideoState(42)
    expect(start).toMatchObject({ time: 42, paused: true, waiting: false, rate: 1 })
    const playing = videoReducer(start, { type: 'played' })
    expect(playing.paused).toBe(false)
    const stalled = videoReducer(playing, { type: 'waiting' })
    expect(videoReducer(stalled, { type: 'flowing' }).waiting).toBe(false)
    expect(videoReducer(start, { type: 'moved', time: 50, buffered: [[0, 60]] })).toMatchObject({
      time: 50,
      buffered: [[0, 60]],
    })
  })
})

const withSettings = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.playbackSettings, DEFAULT_PLAYBACK_STATE)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('usePlaybackLadder', () => {
  it('steps down the ladder on each failure, then gives up', () => {
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport(() => true)
    const { result } = renderHook(
      () =>
        usePlaybackLadder({
          api,
          media: mediaItem({ audioCodec: 'truehd' }),
          audio: null,
          isDefaultAudio: true,
        }),
      { wrapper: withSettings },
    )
    const first = result.current
    expect(first.status).toBe(PLAYBACK_STATUSES.playing)
    if (first.status !== PLAYBACK_STATUSES.playing) return
    const firstMode = first.mode
    act(() => first.fail('first broke'))
    const second = result.current
    if (second.status === PLAYBACK_STATUSES.playing) {
      expect(second.mode).not.toBe(firstMode)
      act(() => second.fail('second broke'))
    }
    const last = result.current
    expect(last.status).toBe(PLAYBACK_STATUSES.unplayable)
    if (last.status !== PLAYBACK_STATUSES.unplayable) return
    expect(last.tryAnyway).toBeNull()
  })

  it('steps a remux the connection cannot carry down to a transcode, and keeps it there', () => {
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport(() => true)
    const defaultTrack: { audio: number | null } = { audio: null }
    const { result, rerender } = renderHook(
      ({ audio }: { audio: number | null }) =>
        usePlaybackLadder({
          api,
          media: mediaItem({ audioCodec: 'truehd' }),
          audio,
          isDefaultAudio: audio == null,
        }),
      { wrapper: withSettings, initialProps: defaultTrack },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.mode).toBe(PLAYBACK_MODES.remux)
    expect(remux.steppedDown).toBeNull()
    const delivery = { delivered: 39_000_000, needed: 70_000_000 }
    act(() => remux.slow?.(delivery))

    const transcode = result.current
    if (transcode.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(transcode.mode).toBe(PLAYBACK_MODES.transcode)
    expect(transcode.steppedDown).toEqual({ from: PLAYBACK_MODES.remux, delivery })
    expect(transcode.slow).toBeNull()

    // Another audio track starts its ladder over, but the connection is no faster.
    rerender({ audio: 1 })
    const otherTrack = result.current
    if (otherTrack.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(otherTrack.mode).toBe(PLAYBACK_MODES.transcode)
  })

  it('lets the viewer pick a way, and the pick outranks a step down', () => {
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport(() => true)
    const { result } = renderHook(
      () =>
        usePlaybackLadder({
          api,
          media: mediaItem({ audioCodec: 'truehd' }),
          audio: null,
          isDefaultAudio: true,
        }),
      { wrapper: withSettings },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.choice.modes).toEqual([PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode])
    act(() => remux.slow?.({ delivered: 39_000_000, needed: 70_000_000 }))
    const slowed = result.current
    if (slowed.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(slowed.mode).toBe(PLAYBACK_MODES.transcode)

    act(() => slowed.choice.pick(PLAYBACK_MODES.remux))
    const picked = result.current
    if (picked.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(picked.mode).toBe(PLAYBACK_MODES.remux)
    expect(picked.steppedDown).toBeNull()

    // A failure steps down from the pick.
    act(() => picked.fail('broke'))
    const failed = result.current
    if (failed.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(failed.mode).toBe(PLAYBACK_MODES.transcode)
  })

  it('converts down to a size the viewer picks, and goes back to the original', () => {
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport(() => true)
    const { result } = renderHook(
      () =>
        usePlaybackLadder({
          api,
          media: mediaItem({
            audioCodec: 'truehd',
            width: 1920,
            height: 1080,
            bitrate: 24_000_000,
          }),
          audio: null,
          isDefaultAudio: true,
        }),
      { wrapper: withSettings },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.quality).toBeNull()
    expect(remux.choice.qualities).toContain('sd480')
    // The default settings cap a transcode at 1080p, and the file is no taller.
    expect(remux.choice.qualities[0]).toBe('high1080')

    act(() => remux.choice.pickQuality('sd480'))
    const small = result.current
    if (small.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(small.mode).toBe(PLAYBACK_MODES.transcode)
    expect(small.quality).toBe('sd480')
    expect(small.choice.quality).toBe('sd480')

    act(() => small.choice.pick(PLAYBACK_MODES.remux))
    const back = result.current
    if (back.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(back.mode).toBe(PLAYBACK_MODES.remux)
    expect(back.quality).toBeNull()
  })

  it('offers no step down when nothing lighter is left', () => {
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport((mime) => !mime.includes('avc1'))
    const { result } = renderHook(
      () =>
        usePlaybackLadder({
          api,
          media: mediaItem({ audioCodec: 'truehd' }),
          audio: null,
          isDefaultAudio: true,
        }),
      { wrapper: withSettings },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.mode).toBe(PLAYBACK_MODES.remux)
    expect(remux.slow).toBeNull()
  })
})
