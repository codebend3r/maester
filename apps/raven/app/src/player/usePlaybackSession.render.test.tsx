import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { PLAYBACK_MODES, type PlaybackMode } from '@raven/core'
import { act, renderHook } from '@testing-library/react-native'

import {
  LOAD_TIMEOUT_MS,
  SESSION_EVENTS,
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

const renderSession = (modes: readonly PlaybackMode[]) =>
  renderHook(() =>
    usePlaybackSession({
      media: { id: 20 },
      modes,
      at: 0,
      audio: null,
      problems: [],
      sources: SOURCES,
    }),
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
})
