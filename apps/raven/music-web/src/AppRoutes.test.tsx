import { describe, expect, it } from 'bun:test'
import {
  HOME_COPY,
  KIT_COPY,
  LIBRARY_PAGE_COPY,
  NOW_PLAYING_COPY,
  SEARCH_COPY,
  SETTINGS_COPY,
  SIGN_IN_COPY,
} from '@raven/wren'
import { QueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { AppRoutes } from '@/AppRoutes'
import { COLLECTION_KINDS, WREN_ROUTES, albumPath, collectionPath } from '@/routes'
import { renderWithProviders, signedIn, signedOut } from '@/test/render'

const title = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name })

/** Home's title is its greeting, whichever the hour gives. */
const HOME_GREETING = new RegExp(`^(${Object.values(HOME_COPY.greeting).join('|')})$`)

type RenderAtProps = { route: string }

/** The app at `route` on a server with accounts on and nobody signed in. */
const renderSignedOut = ({ route }: RenderAtProps) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  signedOut({ client })
  return renderWithProviders({ ui: <AppRoutes />, route, authConfig: null, client })
}

/** The app at `route` on a server with accounts on and the listener signed in. */
const renderSignedIn = ({ route }: RenderAtProps) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  signedIn({ client })
  return renderWithProviders({ ui: <AppRoutes />, route, authConfig: null, client })
}

describe('AppRoutes', () => {
  it.each([
    { route: WREN_ROUTES.home, name: HOME_GREETING },
    { route: WREN_ROUTES.library, name: LIBRARY_PAGE_COPY.title },
    { route: WREN_ROUTES.search, name: SEARCH_COPY.title },
    { route: WREN_ROUTES.settings, name: SETTINGS_COPY.title },
    { route: collectionPath(COLLECTION_KINDS.artists), name: LIBRARY_PAGE_COPY.artists },
  ])('opens $route straight away on a server with accounts off', async ({ route, name }) => {
    renderWithProviders({ ui: <AppRoutes />, route })

    expect(await title(name)).toBeInTheDocument()
  })

  it('opens /now-playing straight away on a server with accounts off', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: WREN_ROUTES.nowPlaying })

    expect(await screen.findByText(NOW_PLAYING_COPY.nothing)).toBeInTheDocument()
  })

  it("opens Albums for a category the web has no page of, such as the apps' Downloads", async () => {
    renderWithProviders({ ui: <AppRoutes />, route: '/collection/downloads' })

    expect(await title(LIBRARY_PAGE_COPY.albums)).toBeInTheDocument()
  })

  it.each([
    { route: WREN_ROUTES.home },
    { route: WREN_ROUTES.settings },
    { route: albumPath(7) },
    { route: WREN_ROUTES.nowPlaying },
  ])('sends a signed-out listener from $route to sign-in', async ({ route }) => {
    renderSignedOut({ route })

    expect(await title(SIGN_IN_COPY.title)).toBeInTheDocument()
  })

  it('opens the page asked for to a signed-in listener', async () => {
    renderSignedIn({ route: WREN_ROUTES.library })

    expect(await title(LIBRARY_PAGE_COPY.title)).toBeInTheDocument()
  })

  it('sends a signed-in listener on sign-in to Home', async () => {
    renderSignedIn({ route: WREN_ROUTES.signIn })

    expect(await title(HOME_GREETING)).toBeInTheDocument()
  })

  it('has no sign-in on a server with accounts off: its address opens Home', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: WREN_ROUTES.signIn })

    expect(await title(HOME_GREETING)).toBeInTheDocument()
  })

  it('opens Home for an address that is no page', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: '/nowhere' })

    expect(await title(HOME_GREETING)).toBeInTheDocument()
  })

  it("shows nothing of the app while the server's word on accounts is on its way", () => {
    renderWithProviders({ ui: <AppRoutes />, route: WREN_ROUTES.home, authConfig: null })

    expect(screen.getByText(KIT_COPY.loading)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
