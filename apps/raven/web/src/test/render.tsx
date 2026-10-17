import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ADMIN_LOCK_STATES,
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
import { queryKeys } from '@/lib/queryClient'
import { PrefetchPlaybackSettings } from '@/lib/prefetchPlaybackSettings'

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
 * admin lock, off as in an admin's browser so every action shows; `null`
 * leaves any to be fetched.
 * `libraries` is the list the side menu reads, for a test that has it read.
 * Returns what Testing Library's `render` does, and the query client.
 */
export const renderWithProviders = ({
  ui,
  route = '/',
  behind = [],
  playback = DEFAULT_PLAYBACK_STATE,
  display = DEFAULT_DISPLAY_SETTINGS,
  adminLock = { state: ADMIN_LOCK_STATES.off },
  libraries = null,
}: {
  ui: ReactNode
  route?: string
  /** Pages already in history before `route`, oldest first, as if the app had been browsed there. */
  behind?: string[]
  playback?: PlaybackSettingsState | null
  display?: DisplaySettings | null
  adminLock?: AdminLock | null
  libraries?: Library[] | null
}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (playback) client.setQueryData(queryKeys.playbackSettings, playback)
  if (display) client.setQueryData(queryKeys.displaySettings, display)
  if (adminLock) client.setQueryData(queryKeys.adminLock, adminLock)
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
