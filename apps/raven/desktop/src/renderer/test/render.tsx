import { mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { act, StrictMode } from 'react'
import { createMemoryRouter, type RouteObject, RouterProvider } from 'react-router-dom'
import type { DesktopClient } from '@/renderer/desktop/client'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import type { PlayerConnection, PlayerConnections } from '@/renderer/desktop/playerConnection'
import { HomePage } from '@/renderer/HomePage/HomePage'
import { desktopRoutes } from '@/renderer/routes'
import { Shell } from '@/renderer/Shell/Shell'
import { useDesktopBridge } from '@/renderer/stores/desktop'
import { DESKTOP_REQUESTS, type DesktopEvent, DESKTOP_REPLIES } from '@/shared/protocol'

/** The real Shell and Home, with stand-ins where they send the page, so the other pages' requests stay out. */
export const STUB_ROUTES: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'play/:fileId', element: <p>Playing</p> },
      { path: 'server/:serverId/:mediaId', element: <p>Playing from a server</p> },
      { path: 'settings', element: <p>Settings page</p> },
      { path: 'downloads', element: <p>Downloads page</p> },
    ],
  },
]

const DONE = { type: DESKTOP_REPLIES.done } as const

type FakeOverrides = Partial<DesktopClient>

/** A client whose calls are recorded; `emit` pushes an event to whoever subscribed. */
export const fakeClient = (overrides: FakeOverrides = {}) => {
  const listeners = new Set<(event: DesktopEvent) => void>()
  const request = mock<DesktopClient['request']>(
    overrides.request ??
      (async (asked) =>
        asked.type === DESKTOP_REQUESTS.listRecents ? { type: 'recents', recents: [] } : DONE),
  )
  const dropFiles = mock<DesktopClient['dropFiles']>(
    overrides.dropFiles ?? (async () => ({ type: 'done' })),
  )
  const subscribe = mock<DesktopClient['subscribe']>((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  return {
    request,
    dropFiles,
    subscribe,
    emit: (event: DesktopEvent) =>
      act(() => {
        listeners.forEach((listener) => listener(event))
      }),
  }
}

/** A connection that changes only when the test says so. */
export const connectionsOf = (initial: PlayerConnection) => {
  const listeners = new Set<() => void>()
  let connection = initial
  return {
    read: () => connection,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: PlayerConnection) =>
      act(() => {
        connection = next
        listeners.forEach((listener) => listener())
      }),
  } satisfies PlayerConnections & { set: (next: PlayerConnection) => void }
}

/** P4's pages play through the html engine, as they do with no video engine. */
const NO_ENGINE: PlayerConnection = {
  status: 'unavailable',
  message: 'The video engine is off for this test.',
}

export const renderDesktop = ({
  client,
  route = '/',
  state,
  routes = desktopRoutes,
  isStrict = false,
  player = connectionsOf(NO_ENGINE),
}: {
  client: DesktopClient
  route?: string
  /** The first entry's `location.state`, as a navigation inside the app would leave it. */
  state?: unknown
  routes?: RouteObject[]
  /** Mounts under StrictMode, which runs every effect twice in development. */
  isStrict?: boolean
  player?: PlayerConnections
}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const menu = createMenuHub()
  const router = createMemoryRouter(routes, {
    initialEntries: [state === undefined ? route : { pathname: route, state }],
  })
  // Before the render, as `main.tsx` does; the setup resets it after each test.
  useDesktopBridge.setState({ desktop: { client, menu, player } })
  const app = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  render(isStrict ? <StrictMode>{app}</StrictMode> : app)
  return { router, menu, queryClient }
}
