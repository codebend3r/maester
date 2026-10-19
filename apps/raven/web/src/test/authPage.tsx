import { jest } from 'bun:test'
import { act, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import type { AuthConfig } from '@raven/core'
import type { AuthClient } from '@/lib/authClient'
import { type AuthSessionStatus, AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { SIGNED_IN, fakeAuthClient, readyConfig } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

/** Prints where the router is, path and query string, so a test can read where a page went. */
export const Where = () => {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{`${pathname}${search}`}</p>
}

export const where = () => screen.getByTestId('where').textContent

/**
 * Renders `page` routed at `path` and opened at `route`, beside `Where`, with
 * an auth client that answers `calls` and the session store as the app has
 * it once the stored session is read: signed in as `SIGNED_IN` or not, and
 * from a recovery link or not. Accounts are on unless `authConfig` says
 * otherwise. Returns what `renderWithProviders` does, and the fake client.
 */
export type AuthPageOptions = {
  route?: string
  calls?: Partial<AuthClient>
  authConfig?: AuthConfig | null
  isSignedIn?: boolean
  isRecovery?: boolean
  status?: AuthSessionStatus
}

export const renderAuthPage = ({
  path,
  page,
  route = path,
  calls = {},
  authConfig = readyConfig,
  isSignedIn = false,
  isRecovery = false,
  status = AUTH_SESSION_STATUSES.ready,
}: AuthPageOptions & { path: string; page: ReactNode }) => {
  const fake = fakeAuthClient({ calls })
  useAuthSession.setState({
    client: fake.client,
    status,
    session: isSignedIn ? SIGNED_IN : null,
    isRecovery,
  })
  const rendered = renderWithProviders({
    authConfig,
    route,
    ui: (
      <>
        <Where />
        <Routes>
          <Route path={path} element={page} />
          <Route path="*" element={null} />
        </Routes>
      </>
    ),
  })
  return { ...rendered, fake }
}

/** Moves the fake clock on one second at a time, as a countdown arms a timer per second. */
export const passSeconds = (seconds: number) =>
  Array.from({ length: seconds }).forEach(() => act(() => jest.advanceTimersByTime(1000)))
