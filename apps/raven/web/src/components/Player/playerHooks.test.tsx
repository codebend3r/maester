import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { sourceFor } from '@/components/Player/useMediaSource'
import { usePlaybackLadder } from '@/components/Player/usePlaybackLadder'
import { initialVideoState, videoReducer } from '@/components/Player/useVideoState'
import { queryKeys } from '@/lib/queryClient'
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

describe('sourceFor', () => {
  it('plays the file itself directly, and a stream of its type otherwise', () => {
    expect(sourceFor({ id: 7, mode: 'direct', audio: null, mime: null })).toEqual({
      kind: 'file',
      url: '/api/media/7/file',
    })
    const stream = sourceFor({ id: 7, mode: 'remux', audio: 1, mime: 'video/mp4' })
    expect(stream.kind).toBe('stream')
    if (stream.kind !== 'stream') return
    expect(stream.mime).toBe('video/mp4')
    expect(stream.url(30)).toContain('/api/media/7/stream')
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
          media: mediaItem({ audioCodec: 'truehd' }),
          audio: null,
          isDefaultAudio: true,
        }),
      { wrapper: withSettings },
    )
    const first = result.current
    expect(first.status).toBe('playing')
    if (first.status !== 'playing') return
    const firstMode = first.mode
    act(() => first.fail('first broke'))
    const second = result.current
    if (second.status === 'playing') {
      expect(second.mode).not.toBe(firstMode)
      act(() => second.fail('second broke'))
    }
    const last = result.current
    expect(last.status).toBe('unplayable')
    if (last.status !== 'unplayable') return
    expect(last.tryAnyway).toBeNull()
  })
})
