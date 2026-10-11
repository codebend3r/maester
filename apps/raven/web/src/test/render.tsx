import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettingsState } from '@raven/core'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { queryKeys } from '@/lib/queryClient'

/** The server's playback settings as a fresh install has them. */
export const DEFAULT_PLAYBACK_STATE: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: 'software', tonemapAvailable: true },
}

/**
 * Renders inside a fresh query client and an in-memory router, starting at
 * `route`. The server's playback settings are already known, as they are
 * once a page has read them; `playback: null` leaves them to be fetched.
 */
export const renderWithProviders = (
  ui: ReactNode,
  {
    route = '/',
    playback = DEFAULT_PLAYBACK_STATE,
  }: { route?: string; playback?: PlaybackSettingsState | null } = {},
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (playback) client.setQueryData(queryKeys.playbackSettings, playback)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}
