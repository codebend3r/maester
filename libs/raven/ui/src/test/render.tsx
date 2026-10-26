import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettingsState } from '@raven/core'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { PlayerServices } from '@/components/Player/PlayerServices'
import { playerQueryKeys } from '@/lib/playerQueryKeys'
import { usePlayerServices } from '@/stores/playerServices'

export const DEFAULT_PLAYBACK_STATE: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: 'software', tonemapAvailable: true },
}

type RenderWithProvidersProps = {
  ui: ReactNode
  route?: string
  behind?: string[]
  playback?: PlaybackSettingsState | null
  /** Set before the first render, as a host sets them; left out for a host the test renders itself. */
  services?: PlayerServices
}

/** The player's host requirements: a query cache, a router and its services in the store. */
export const renderWithProviders = ({
  ui,
  route = '/',
  behind = [],
  playback = DEFAULT_PLAYBACK_STATE,
  services,
}: RenderWithProvidersProps) => {
  if (services) usePlayerServices.setState({ services })
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
