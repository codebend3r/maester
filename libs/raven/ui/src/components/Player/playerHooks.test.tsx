import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
})
