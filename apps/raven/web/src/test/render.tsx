import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
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
import { queryKeys } from '@/lib/queryClient'
import { SharedPlaybackPolicy } from '@/lib/sharedPlaybackPolicy'

/** The server's playback settings as a fresh install has them. */
export const DEFAULT_PLAYBACK_STATE: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: 'software', tonemapAvailable: true },
}

/**
 * Renders inside a fresh query client and an in-memory router, starting at
 * `route`, wrapped as `main.tsx` wraps the app: the shared playback policy,
 * and what card links follow. The server's playback and display settings
 * are already known, as they are once a page has read them, and so is the
 * admin lock, off as in an admin's browser so every action shows; `null`
 * leaves any to be fetched.
 * `libraries` is the list the side menu reads, for a test that has it read.
 * Returns what Testing Library's `render` does, and the query client.
 */
export const renderWithProviders = (
  ui: ReactNode,
  {
    route = '/',
    playback = DEFAULT_PLAYBACK_STATE,
    display = DEFAULT_DISPLAY_SETTINGS,
    adminLock = { state: 'off' },
    libraries = null,
  }: {
    route?: string
    playback?: PlaybackSettingsState | null
    display?: DisplaySettings | null
    adminLock?: AdminLock | null
    libraries?: Library[] | null
  } = {},
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (playback) client.setQueryData(queryKeys.playbackSettings, playback)
  if (display) client.setQueryData(queryKeys.displaySettings, display)
  if (adminLock) client.setQueryData(queryKeys.adminLock, adminLock)
  if (libraries) client.setQueryData(queryKeys.libraries, libraries)
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <SharedPlaybackPolicy>
          <CardLinks>{ui}</CardLinks>
        </SharedPlaybackPolicy>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...rendered, client }
}
