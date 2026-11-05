import { afterEach, describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MEDIA_ORIGIN_KINDS,
  type MediaOrigin,
  PICTURE_SUBTITLES,
  PLAYBACK_MODES,
  type RemotePlayback,
} from '@raven/core'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  PLAYBACK_STATUSES,
  type PlaybackFailure,
  usePlaybackLadder,
} from '@/components/Player/usePlaybackLadder'
import { initialVideoState, videoReducer } from '@/components/Player/videoState'
import { api } from '@/test/api'
import { PICK_KINDS } from '@/components/Player/playChoices'
import { playerQueryKeys as queryKeys } from '@/lib/playerQueryKeys'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE } from '@/test/render'
import { useMediaOrigin } from '@/stores/mediaOrigin'

describe('videoReducer', () => {
  it('starts paused at the resume point, and follows the element', () => {
    const start = initialVideoState(42)
    expect(start).toMatchObject({ time: 42, paused: true, waiting: true, rate: 1 })
    const playing = videoReducer(videoReducer(start, { type: 'played' }), { type: 'flowing' })
    expect(playing).toMatchObject({ paused: false, waiting: false })
    const stalled = videoReducer(playing, { type: 'waiting' })
    expect(stalled.waiting).toBe(true)
    expect(videoReducer(stalled, { type: 'flowing' }).waiting).toBe(false)
    expect(videoReducer(stalled, { type: 'paused' }).waiting).toBe(false)
    // A paused video waits for nothing it shows, as on a seek while paused.
    expect(videoReducer(videoReducer(start, { type: 'paused' }), { type: 'waiting' }).waiting).toBe(
      false,
    )
    expect(videoReducer(start, { type: 'moved', time: 50, buffered: [[0, 60]] })).toMatchObject({
      time: 50,
      buffered: [[0, 60]],
    })
  })
})

/** A way that failed before the picture had a time or a frame. */
const failure = (message: string): PlaybackFailure => ({
  message,
  position: null,
  frame: null,
  frames: null,
})

type WithSettingsProps = { children: ReactNode }

const withSettings = ({ children }: WithSettingsProps) => {
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
          burn: null,
        }),
      { wrapper: withSettings },
    )
    const first = result.current
    expect(first.status).toBe(PLAYBACK_STATUSES.playing)
    if (first.status !== PLAYBACK_STATUSES.playing) return
    const firstMode = first.rendition.mode
    act(() => first.fail(failure('first broke')))
    const second = result.current
    if (second.status === PLAYBACK_STATUSES.playing) {
      expect(second.rendition.mode).not.toBe(firstMode)
      act(() => second.fail(failure('second broke')))
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
    type CallbackRenderHookCallbackProps = { audio: number | null }

    const { result, rerender } = renderHook(
      ({ audio }: CallbackRenderHookCallbackProps) =>
        usePlaybackLadder({
          api,
          media: mediaItem({ audioCodec: 'truehd' }),
          audio,
          isDefaultAudio: audio == null,
          burn: null,
        }),
      { wrapper: withSettings, initialProps: defaultTrack },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.rendition.mode).toBe(PLAYBACK_MODES.remux)
    expect(remux.steppedDown).toBeNull()
    const delivery = { delivered: 39_000_000, needed: 70_000_000 }
    act(() => remux.slow?.(delivery))

    const transcode = result.current
    if (transcode.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(transcode.rendition.mode).toBe(PLAYBACK_MODES.transcode)
    expect(transcode.steppedDown).toEqual({ from: PLAYBACK_MODES.remux, delivery })
    expect(transcode.slow).toBeNull()

    // Another audio track starts its ladder over, but the connection is no faster.
    rerender({ audio: 1 })
    const otherTrack = result.current
    if (otherTrack.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(otherTrack.rendition.mode).toBe(PLAYBACK_MODES.transcode)
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
          burn: null,
        }),
      { wrapper: withSettings },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.choices.groups[0]?.options[0]?.pick).toEqual({
      kind: PICK_KINDS.mode,
      mode: PLAYBACK_MODES.remux,
    })
    act(() => remux.slow?.({ delivered: 39_000_000, needed: 70_000_000 }))
    const slowed = result.current
    if (slowed.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(slowed.rendition.mode).toBe(PLAYBACK_MODES.transcode)

    act(() => slowed.choices.select({ kind: PICK_KINDS.mode, mode: PLAYBACK_MODES.remux }))
    const picked = result.current
    if (picked.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(picked.rendition.mode).toBe(PLAYBACK_MODES.remux)
    expect(picked.steppedDown).toBeNull()

    // A failure steps down from the pick.
    act(() => picked.fail(failure('broke')))
    const failed = result.current
    if (failed.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(failed.rendition.mode).toBe(PLAYBACK_MODES.transcode)
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
          burn: null,
        }),
      { wrapper: withSettings },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.rendition.quality).toBeNull()
    const sizes = remux.choices.groups.find((group) => group.legend === 'Quality')
    const picks = sizes?.options.map((option) => option.pick) ?? []
    expect(picks).toContainEqual({ kind: PICK_KINDS.size, quality: 'sd480' })
    // The default settings cap a transcode at 1080p, and the file is no taller.
    expect(picks[1]).toEqual({ kind: PICK_KINDS.size, quality: 'high1080' })

    act(() => remux.choices.select({ kind: PICK_KINDS.size, quality: 'sd480' }))
    const small = result.current
    if (small.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(small.rendition.mode).toBe(PLAYBACK_MODES.transcode)
    expect(small.rendition.quality).toBe('sd480')

    act(() => small.choices.select({ kind: PICK_KINDS.mode, mode: PLAYBACK_MODES.remux }))
    const back = result.current
    if (back.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(back.rendition.mode).toBe(PLAYBACK_MODES.remux)
    expect(back.rendition.quality).toBeNull()
  })

  it('plays a picture subtitle only as a transcode, which burns it in', () => {
    setBrowserSupport(() => true)
    setStreamSupport(() => true)
    const { result } = renderHook(
      () =>
        usePlaybackLadder({
          api,
          media: mediaItem(),
          audio: null,
          isDefaultAudio: true,
          burn: 'embedded-2',
        }),
      { wrapper: withSettings },
    )
    const burning = result.current
    if (burning.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(burning.choices.pictures).toBe(PICTURE_SUBTITLES.burned)
    expect(burning.rendition).toEqual({
      mode: PLAYBACK_MODES.transcode,
      quality: null,
      burn: 'embedded-2',
    })
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
          burn: null,
        }),
      { wrapper: withSettings },
    )
    const remux = result.current
    if (remux.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(remux.rendition.mode).toBe(PLAYBACK_MODES.remux)
    expect(remux.slow).toBeNull()
  })
})

const PUBLIC_ORIGIN: MediaOrigin = { kind: MEDIA_ORIGIN_KINDS.public, url: 'https://raven.example' }
const LAN_ORIGIN: MediaOrigin = { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://lan.example' }
const HELD_TO_720: RemotePlayback = { limit: 'high720', isOutside: false }

type PlayFromProps = { origin: MediaOrigin | null; remote: RemotePlayback; bitrate: number }

/** A 1080p file the browser plays as it is, from `origin` (null for the server's own address). */
const playFrom = ({ origin, remote, bitrate }: PlayFromProps) => {
  setBrowserSupport(() => true)
  setStreamSupport(() => true)
  // In act: a hook rendered earlier in the same test reads the store too.
  act(() => useMediaOrigin.setState({ pick: origin && { origin, at: Date.now() }, remote }))
  const media = mediaItem({ width: 1920, height: 1080, bitrate })
  return renderHook(
    () => usePlaybackLadder({ api, media, audio: null, isDefaultAudio: true, burn: null }),
    { wrapper: withSettings },
  )
}

describe('usePlaybackLadder away from home', () => {
  // Unmounted first, so the reset is not an update outside act.
  afterEach(() => {
    cleanup()
    useMediaOrigin.setState({ pick: null, remote: null })
  })

  it('starts a file over the remote limit as a transcode at the limit from a public origin', () => {
    const { result } = playFrom({
      origin: PUBLIC_ORIGIN,
      remote: HELD_TO_720,
      bitrate: 24_000_000,
    })
    const away = result.current
    if (away.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(away.rendition).toEqual({
      mode: PLAYBACK_MODES.transcode,
      quality: 'high720',
      burn: null,
    })
    const sizes = away.choices.groups.find((group) => group.legend === 'Quality')
    const checked = sizes?.options.find((option) => option.isChecked)
    expect(checked?.pick).toEqual({ kind: PICK_KINDS.size, quality: 'high720' })

    // The other ways stay behind it to step down to.
    act(() => away.fail(failure('broke')))
    const stepped = result.current
    if (stepped.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(stepped.rendition.mode).toBe(PLAYBACK_MODES.direct)
  })

  it('plays as at home from a LAN origin, or for a file under the limit', () => {
    const lan = playFrom({ origin: LAN_ORIGIN, remote: HELD_TO_720, bitrate: 24_000_000 }).result
    if (lan.current.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(lan.current.rendition).toEqual({
      mode: PLAYBACK_MODES.direct,
      quality: null,
      burn: null,
    })

    const small = playFrom({
      origin: PUBLIC_ORIGIN,
      remote: HELD_TO_720,
      bitrate: 3_000_000,
    }).result
    if (small.current.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(small.current.rendition).toEqual({
      mode: PLAYBACK_MODES.direct,
      quality: null,
      burn: null,
    })
  })

  it('goes by where the request came from when no media origin is picked', () => {
    const outside = playFrom({
      origin: null,
      remote: { ...HELD_TO_720, isOutside: true },
      bitrate: 24_000_000,
    }).result
    if (outside.current.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(outside.current.rendition.mode).toBe(PLAYBACK_MODES.transcode)
    expect(outside.current.rendition.quality).toBe('high720')

    const inside = playFrom({ origin: null, remote: HELD_TO_720, bitrate: 24_000_000 }).result
    if (inside.current.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(inside.current.rendition.mode).toBe(PLAYBACK_MODES.direct)
  })

  it('lets a viewer pick a size or the original over the remote limit', () => {
    const { result } = playFrom({
      origin: PUBLIC_ORIGIN,
      remote: HELD_TO_720,
      bitrate: 24_000_000,
    })
    const away = result.current
    if (away.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    act(() => away.choices.select({ kind: PICK_KINDS.size, quality: 'sd480' }))
    const small = result.current
    if (small.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(small.rendition).toEqual({
      mode: PLAYBACK_MODES.transcode,
      quality: 'sd480',
      burn: null,
    })

    act(() => small.choices.select({ kind: PICK_KINDS.mode, mode: PLAYBACK_MODES.direct }))
    const original = result.current
    if (original.status !== PLAYBACK_STATUSES.playing) throw new Error('Not playing')
    expect(original.rendition).toEqual({ mode: PLAYBACK_MODES.direct, quality: null, burn: null })
  })
})
