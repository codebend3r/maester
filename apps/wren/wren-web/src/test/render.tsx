import { AUTH_CONFIG_STATES, type AuthConfig } from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AuthClient } from '@/lib/authClient'
import { WREN_ROUTES } from '@/routes'
import { AUTH_SESSION_STATUSES, type SessionSummary, useAuthSession } from '@/stores/authSession'
import { SIGNED_IN, fakeAuthClient, readyConfig } from '@/test/authClient'
import { atFormFactor } from '@/test/viewport'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

/** The server with accounts off, as the local fixture server runs: no sign-in, every page open. */
const ACCOUNTS_OFF: AuthConfig = { state: AUTH_CONFIG_STATES.off }

/** A fresh cache that never retries, so a failure a test answers with shows at once. */
export const testQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** What stands for each page a kit piece can open, under `renderKitWithRoutes`. */
export const KIT_PAGES = {
  album: 'An album is showing',
  artist: 'An artist is showing',
  library: 'Library is showing',
} as const

type SignInAsProps = {
  /** The cache the pages read the server's config from. */
  client: QueryClient
  /** The auth client the session holds; a fake that expects no call unless this names one. */
  auth?: AuthClient
}

type WithSessionProps = SignInAsProps & { session: SessionSummary | null }

/** A server with accounts on, its auth client built and the session it holds already read. */
const withSession = ({
  client,
  auth = fakeAuthClient().client,
  session,
}: WithSessionProps): void => {
  client.setQueryData(queryKeys.authConfig, readyConfig)
  useAuthSession.setState({
    client: auth,
    clientLoad: Promise.resolve(auth),
    session,
    status: AUTH_SESSION_STATUSES.ready,
  })
}

/** A server with accounts on and the listener signed in to it, their session already read. */
export const signedIn = (props: SignInAsProps): void =>
  withSession({ ...props, session: SIGNED_IN })

/** A server with accounts on and nobody signed in, the auth client built and waiting. */
export const signedOut = (props: SignInAsProps): void => withSession({ ...props, session: null })

type RenderWithProvidersProps = {
  ui: ReactNode
  route?: string
  /** Pages already in history before `route`, oldest first, as if the app had been browsed there. */
  behind?: string[]
  /** The layout the window is as wide as: the wide one, the apps' tablet's, unless this says phone. */
  formFactor?: FormFactor
  /**
   * What the server says about accounts, already read: off, so every page is open, unless this
   * says otherwise; `null` leaves it to be fetched. A test of a signed-in or signed-out listener
   * passes `null` and calls `signedIn` or `signedOut` with its `client`.
   */
  authConfig?: AuthConfig | null
  /** The cache to render over, for a test that fills it first. */
  client?: QueryClient
}

/**
 * Renders `ui` inside a fresh query client that never retries and an in-memory router starting
 * at `route`, in a window as wide as `formFactor`'s layout. Returns what Testing Library's
 * `render` does, and the query client.
 */
export const renderWithProviders = ({
  ui,
  route = '/',
  behind = [],
  formFactor = FORM_FACTORS.tablet,
  authConfig = ACCOUNTS_OFF,
  client = testQueryClient(),
}: RenderWithProvidersProps) => {
  atFormFactor(formFactor)
  if (authConfig !== null) client.setQueryData(queryKeys.authConfig, authConfig)
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[...behind, route]} initialIndex={behind.length}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...rendered, client }
}

/** Renders a kit piece with a page for each address a press on it can open. */
export const renderKitWithRoutes = (ui: ReactNode) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={ui} path={WREN_ROUTES.home} />
        <Route element={<p>{KIT_PAGES.album}</p>} path={WREN_ROUTES.album} />
        <Route element={<p>{KIT_PAGES.artist}</p>} path={WREN_ROUTES.artist} />
        <Route element={<p>{KIT_PAGES.library}</p>} path={WREN_ROUTES.library} />
      </Routes>
    ),
  })
