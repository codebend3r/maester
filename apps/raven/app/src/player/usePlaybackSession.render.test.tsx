import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { PLAYBACK_MODES, type PlaybackMode } from '@raven/core'
import { act, renderHook } from '@testing-library/react-native'

import {
  LOAD_TIMEOUT_MS,
  SESSION_EVENTS,
  STALL_REOPEN_MS,
  SESSION_PHASES,
  type SessionState,
  modeOf,
  usePlaybackSession,
} from '@/player/usePlaybackSession'
import type { MediaSources, SourceRequest } from '@/servers/mediaAccess'

const { direct, remux, transcode } = PLAYBACK_MODES

/** Sources that answer at once, each naming the way it was asked for. */
const SOURCES: MediaSources = {
  source: async ({ mode }: SourceRequest) => ({
    ok: true,
    source: { uri: `http://nas:8080/${mode}`, headers: {} },
  }),
  close: () => undefined,
}

const attemptOf = (state: SessionState): number =>
  state.phase === SESSION_PHASES.failed ? -1 : state.attempt

type RenderSessionProps = { isWaiting: boolean; clock?: number }

const renderSession = (modes: readonly PlaybackMode[]) =>
  renderHook(
    ({ isWaiting, clock = 0 }: RenderSessionProps) =>
      usePlaybackSession({
        media: { id: 20 },
        modes,
        at: 0,
        audio: null,
        problems: [],
        sources: SOURCES,
        isWaiting,
        clock,
      }),
    { initialProps: { isWaiting: false } },
  )

/** Lets the session's source requests answer. */
const settle = async () => act(async () => undefined)

describe('usePlaybackSession', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('takes no late load for a way it timed out, and times the next way afresh', async () => {
    const { result } = await renderSession([direct, remux, transcode])
    await settle()
    expect(result.current.state.phase).toBe(SESSION_PHASES.loading)
    const timedOut = attemptOf(result.current.state)

    await act(async () => {
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS)
    })
    await settle()
    expect(modeOf(result.current.state)).toBe(remux)
    expect(result.current.state.phase).toBe(SESSION_PHASES.loading)

    await act(async () => {
      result.current.dispatch({ type: SESSION_EVENTS.loaded, attempt: timedOut })
    })
    expect(modeOf(result.current.state)).toBe(remux)
    expect(result.current.state.phase).toBe(SESSION_PHASES.loading)

    await act(async () => {
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS - 1)
    })
    expect(modeOf(result.current.state)).toBe(remux)
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    await settle()
    expect(modeOf(result.current.state)).toBe(transcode)
  })

  it('stops the clock once the way it timed loads', async () => {
    const { result } = await renderSession([direct, remux])
    await settle()
    await act(async () => {
      result.current.dispatch({
        type: SESSION_EVENTS.loaded,
        attempt: attemptOf(result.current.state),
      })
    })
    await act(async () => {
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS * 2)
    })
    expect(result.current.state.phase).toBe(SESSION_PHASES.playing)
    expect(modeOf(result.current.state)).toBe(direct)
  })

  describe('a stall', () => {
    /** The session playing its first way, its source loaded. */
    const playing = async (modes: readonly PlaybackMode[]) => {
      const session = await renderSession(modes)
      await settle()
      await act(async () => {
        session.result.current.dispatch({
          type: SESSION_EVENTS.loaded,
          attempt: attemptOf(session.result.current.state),
        })
      })
      return session
    }

    it('opens a direct play again from the spot once it has waited for data too long, as a lapsed ticket leaves AVPlayer', async () => {
      const { result, rerender } = await playing([direct, remux])
      await rerender({ isWaiting: true, clock: 312.5 })
      await act(async () => {
        jest.advanceTimersByTime(STALL_REOPEN_MS - 1)
      })
      expect(result.current.state.phase).toBe(SESSION_PHASES.playing)
      await act(async () => {
        jest.advanceTimersByTime(1)
      })
      expect(modeOf(result.current.state)).toBe(direct)
      expect(result.current.state).toMatchObject({ at: 312.5, attempt: 1 })
    })

    it('waits while the clock still moves, as a player still playing what it holds', async () => {
      const { result, rerender } = await playing([direct, remux])
      await rerender({ isWaiting: true, clock: 1 })
      await act(async () => {
        jest.advanceTimersByTime(STALL_REOPEN_MS - 1)
      })
      await rerender({ isWaiting: true, clock: 2 })
      await act(async () => {
        jest.advanceTimersByTime(STALL_REOPEN_MS - 1)
      })
      expect(result.current.state).toMatchObject({ phase: SESSION_PHASES.playing, attempt: 0 })
    })

    it('lets a stall end by itself when the data comes', async () => {
      const { result, rerender } = await playing([direct, remux])
      await rerender({ isWaiting: true })
      await act(async () => {
        jest.advanceTimersByTime(STALL_REOPEN_MS - 1)
      })
      await rerender({ isWaiting: false })
      await act(async () => {
        jest.advanceTimersByTime(STALL_REOPEN_MS * 2)
      })
      expect(result.current.state).toMatchObject({ phase: SESSION_PHASES.playing, attempt: 0 })
    })

    it('leaves a stream to its player, which says when the server let go of it', async () => {
      const { result, rerender } = await playing([remux, transcode])
      await rerender({ isWaiting: true })
      await act(async () => {
        jest.advanceTimersByTime(STALL_REOPEN_MS * 2)
      })
      expect(result.current.state).toMatchObject({ phase: SESSION_PHASES.playing, attempt: 0 })
    })
  })
})
