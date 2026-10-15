import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettingsState } from '@raven/core'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { playerQueryKeys } from '@/lib/playerQueryKeys'

export const DEFAULT_PLAYBACK_STATE: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: 'software', tonemapAvailable: true },
}

/** The player's only host requirements: a query cache and a router. */
export const renderWithProviders = (
  ui: ReactNode,
  {
    route = '/',
    behind = [],
    playback = DEFAULT_PLAYBACK_STATE,
  }: { route?: string; behind?: string[]; playback?: PlaybackSettingsState | null } = {},
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (playback) client.setQueryData(playerQueryKeys.playbackSettings, playback)
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[...behind, route]} initialIndex={behind.length}>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    client,
  }
}
