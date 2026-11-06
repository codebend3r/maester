import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, waitFor } from '@testing-library/react'
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  type DisplaySettings,
  ENCODER_KINDS,
  type PlaybackSettingsState,
  TITLE_DISPLAYS,
} from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { useServerSettingsSaves } from '@/query/useServerSettingsSaves'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const { api } = recordingApi({ body: null })
const queries = ravenQueriesFor(api)

const EFFECTIVE = { encoder: ENCODER_KINDS.software, tonemapAvailable: true }

const stateOf = (settings: PlaybackSettingsState['settings']): PlaybackSettingsState => ({
  settings,
  effective: EFFECTIVE,
})

const CHANGED = stateOf({ ...DEFAULT_PLAYBACK_SETTINGS, maxHeight: 720 })
const TEXT_TITLES: DisplaySettings = { titles: TITLE_DISPLAYS.text }

const spies = {
  readPlayback: spyOn(api, 'getPlaybackSettings'),
  readDisplay: spyOn(api, 'getDisplaySettings'),
  savePlayback: spyOn(api, 'setPlaybackSettings'),
  saveDisplay: spyOn(api, 'setDisplaySettings'),
}

/** The hook with the server holding `playback` and `display`. */
const setUp = (playback: PlaybackSettingsState, display: DisplaySettings) => {
  spies.readPlayback.mockImplementation(async () => playback)
  spies.readDisplay.mockImplementation(async () => display)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onReset = mock(() => undefined)
  const { result } = renderQueryHook({
    client,
    hook: () => useServerSettingsSaves({ api, queries, onReset }),
  })
  return { result, client, onReset }
}

describe('useServerSettingsSaves', () => {
  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  it('counts settings not read yet as at their defaults', () => {
    spies.readPlayback.mockImplementation(() => new Promise(() => undefined))
    spies.readDisplay.mockImplementation(() => new Promise(() => undefined))
    const client = new QueryClient()
    const { result } = renderQueryHook({
      client,
      hook: () => useServerSettingsSaves({ api, queries, onReset: () => undefined }),
    })
    expect(result.current.isAllAtDefaults).toBe(true)
    expect(result.current.isBusy).toBe(false)
  })

  it('knows a changed playback or display setting is off its default', async () => {
    const { result } = setUp(CHANGED, DEFAULT_DISPLAY_SETTINGS)
    await waitFor(() => expect(result.current.playback.data).toEqual(CHANGED))
    expect(result.current.isAllAtDefaults).toBe(false)
    const display = setUp(stateOf(DEFAULT_PLAYBACK_SETTINGS), TEXT_TITLES)
    await waitFor(() => expect(display.result.current.display.data).toEqual(TEXT_TITLES))
    expect(display.result.current.isAllAtDefaults).toBe(false)
  })

  it('shows a playback change before the server answers, and puts it back when refused', async () => {
    const answer = Promise.withResolvers<PlaybackSettingsState>()
    spies.savePlayback.mockImplementation(() => answer.promise)
    const { result, client } = setUp(stateOf(DEFAULT_PLAYBACK_SETTINGS), DEFAULT_DISPLAY_SETTINGS)
    await waitFor(() => expect(result.current.playback.data).toBeDefined())
    act(() => result.current.save.mutate({ maxHeight: 720 }))
    await waitFor(() =>
      expect(
        client.getQueryData<PlaybackSettingsState>(queryKeys.playbackSettings)?.settings.maxHeight,
      ).toBe(720),
    )
    expect(result.current.isBusy).toBe(true)
    answer.reject(new Error('refused'))
    await waitFor(() => expect(result.current.save.failure?.message).toBe('refused'))
    expect(
      client.getQueryData<PlaybackSettingsState>(queryKeys.playbackSettings)?.settings.maxHeight,
    ).toBe(DEFAULT_PLAYBACK_SETTINGS.maxHeight)
  })

  it('shows a display change at once and saves it', async () => {
    spies.saveDisplay.mockImplementation(() => new Promise(() => undefined))
    const { result, client } = setUp(stateOf(DEFAULT_PLAYBACK_SETTINGS), DEFAULT_DISPLAY_SETTINGS)
    await waitFor(() => expect(result.current.display.data).toBeDefined())
    act(() => result.current.saveDisplay.mutate(TEXT_TITLES))
    await waitFor(() =>
      expect(client.getQueryData<DisplaySettings>(queryKeys.displaySettings)).toEqual(TEXT_TITLES),
    )
    expect(spies.saveDisplay).toHaveBeenCalledWith(TEXT_TITLES)
  })

  it('resets both to their defaults, tells the host and reads both again', async () => {
    spies.savePlayback.mockImplementation(async () => stateOf(DEFAULT_PLAYBACK_SETTINGS))
    spies.saveDisplay.mockImplementation(async () => DEFAULT_DISPLAY_SETTINGS)
    const { result, onReset } = setUp(CHANGED, TEXT_TITLES)
    await waitFor(() => expect(result.current.isAllAtDefaults).toBe(false))
    spies.readPlayback.mockImplementation(async () => stateOf(DEFAULT_PLAYBACK_SETTINGS))
    spies.readDisplay.mockImplementation(async () => DEFAULT_DISPLAY_SETTINGS)
    act(() => result.current.reset.mutate())
    await waitFor(() => expect(result.current.reset.isSuccess).toBe(true))
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(spies.savePlayback).toHaveBeenCalledWith(DEFAULT_PLAYBACK_SETTINGS)
    expect(spies.saveDisplay).toHaveBeenCalledWith(DEFAULT_DISPLAY_SETTINGS)
    await waitFor(() => expect(result.current.isAllAtDefaults).toBe(true))
  })
})
