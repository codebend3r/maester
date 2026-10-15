import { describe, expect, it } from 'bun:test'
import type { PlaybackMode } from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook } from '@testing-library/react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { sourceFor, useMediaSource } from '@/components/Player/useMediaSource'
import { usePlaybackLadder } from '@/components/Player/usePlaybackLadder'
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

describe('sourceFor', () => {
  it('plays the file itself directly, and a stream of its type otherwise', () => {
    expect(sourceFor({ api, id: 7, mode: 'direct', audio: null, mime: null })).toEqual({
      kind: 'file',
      url: '/api/media/7/file',
    })
    const stream = sourceFor({ api, id: 7, mode: 'remux', audio: 1, mime: 'video/mp4' })
    expect(stream.kind).toBe('stream')
    if (stream.kind !== 'stream') return
    expect(stream.mime).toBe('video/mp4')
    expect(stream.url(30)).toContain('/api/media/7/stream')
  })
})

describe('useMediaSource', () => {
  it('drops an error from the source it is replacing', async () => {
    const media = mediaItem()
    const reports: string[] = []
    const Harness = ({
      mode,
      onCommit,
    }: {
      mode: PlaybackMode
      onCommit: (video: HTMLVideoElement | null) => void
    }) => {
      const videoRef = useRef<HTMLVideoElement>(null)
      const position = useRef(0)
      const playing = useRef(false)
      useMediaSource({
        videoRef,
        source: { kind: 'server', media, api },
        mode,
        audio: null,
        position,
        playing,
        onRefused: () => {},
        onFailure: (message) => reports.push(`${mode}: ${message}`),
      })
      // After the commit and before the effect that swaps the source: where
      // an event the browser queued for the old source can still land.
      useLayoutEffect(() => {
        onCommit(videoRef.current)
      })
      return (
        <video ref={videoRef}>
          <track kind="captions" />
        </video>
      )
    }
    const { rerender } = render(<Harness mode="direct" onCommit={() => {}} />)
    rerender(
      <Harness mode="remux" onCommit={(video) => video?.dispatchEvent(new Event('error'))} />,
    )
    await act(async () => {})
    // happy-dom has no MediaSource, so the remux fails on its own account.
    expect(reports).toEqual(["remux: This browser can't play converted video."])
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
