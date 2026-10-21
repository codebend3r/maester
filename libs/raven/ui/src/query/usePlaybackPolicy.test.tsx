import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { DEFAULT_PLAYBACK_SETTINGS, ENCODER_KINDS, type PlaybackSettingsState } from '@raven/core'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { usePlaybackPolicy } from '@/query/usePlaybackPolicy'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const STATE: PlaybackSettingsState = {
  settings: { ...DEFAULT_PLAYBACK_SETTINGS, maxHeight: 2160 },
  effective: { encoder: ENCODER_KINDS.software, tonemapAvailable: true },
}

/** The hook over queries whose settings answer with `body`. */
const policyFor = (body: unknown) => {
  const { api } = recordingApi({ body })
  const queries = ravenQueriesFor(api)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderQueryHook({ client, hook: () => usePlaybackPolicy({ queries }) }).result
}

describe('usePlaybackPolicy', () => {
  it("is null until the settings answer, then the server's settings", async () => {
    const result = policyFor(STATE)
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toEqual(STATE.settings))
  })

  it('falls back to the defaults, as the server does, when the settings cannot be read', async () => {
    const result = policyFor({ settings: 'unreadable' })
    await waitFor(() => expect(result.current).toEqual(DEFAULT_PLAYBACK_SETTINGS))
  })
})
