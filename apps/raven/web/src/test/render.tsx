import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ADMIN_LOCK_STATES,
  AUTH_CONFIG_STATES,
  type Account,
  type AuthConfig,
  type AdminLock,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  type DisplaySettings,
  type Library,
  type PlaybackSettingsState,
} from '@raven/core'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { CardLinks } from '@/components/CardLink/CardLink'
import { MediaOriginProbe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { queryKeys } from '@raven/ui/headless'
import { PrefetchPlaybackSettings } from '@/lib/prefetchPlaybackSettings'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { readyConfig } from '@/test/authClient'

/** The server's playback settings as a fresh install has them. */
export const DEFAULT_PLAYBACK_STATE: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: 'software', tonemapAvailable: true },
}

/**
 * Renders `ui` inside a fresh query client and an in-memory router, starting at
 * `route` with the pages in `behind` before it in history, wrapped as
 * `main.tsx` wraps the app: the playback settings prefetch, the media origin probe, and what card
 * links follow. The server's playback and display settings
 * are already known, as they are once a page has read them, and so is the
 * admin lock, off as in an admin's browser so every action shows, and so is
 * the server's account config, off as on a server without accounts; `null`
 * leaves any to be fetched. `account` renders as that account signed in on a
 * server with accounts on, its `/api/me` already read.
 * `libraries` is the list the side menu reads, for a test that has it read.
 * Returns what Testing Library's `render` does, and the query client (a fresh one unless `client` names it).
 */
export const renderWithProviders = ({
  ui,
  route = '/',
  behind = [],
  playback = DEFAULT_PLAYBACK_STATE,
  display = DEFAULT_DISPLAY_SETTINGS,
  adminLock = { state: ADMIN_LOCK_STATES.off },
  authConfig = { state: AUTH_CONFIG_STATES.off },
  account = null,
  libraries = null,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: {
  ui: ReactNode
  route?: string
  /** Pages already in history before `route`, oldest first, as if the app had been browsed there. */
  behind?: string[]
  playback?: PlaybackSettingsState | null
  display?: DisplaySettings | null
  adminLock?: AdminLock | null
  authConfig?: AuthConfig | null
  account?: Account | null
  libraries?: Library[] | null
  /** The cache to render over, for a test that needs the one the session store resets. */
  client?: QueryClient
}) => {
  if (playback) client.setQueryData(queryKeys.playbackSettings, playback)
  if (display) client.setQueryData(queryKeys.displaySettings, display)
  if (adminLock) client.setQueryData(queryKeys.adminLock, adminLock)
  if (account) {
    useAuthSession.setState({
      status: AUTH_SESSION_STATUSES.ready,
      session: { accessToken: 't', userId: account.id },
    })
    client.setQueryDefaults(queryKeys.account(account.id), { staleTime: Infinity })
    client.setQueryData(queryKeys.account(account.id), account)
    client.setQueryData(queryKeys.authConfig, readyConfig)
  } else if (authConfig) {
    client.setQueryData(queryKeys.authConfig, authConfig)
  }
  if (libraries) client.setQueryData(queryKeys.libraries, libraries)
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[...behind, route]} initialIndex={behind.length}>
        <PrefetchPlaybackSettings>
          <MediaOriginProbe>
            <CardLinks>{ui}</CardLinks>
          </MediaOriginProbe>
        </PrefetchPlaybackSettings>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...rendered, client }
}
