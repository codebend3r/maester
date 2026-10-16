import { mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, type RouteObject, RouterProvider } from 'react-router-dom'
import type { DesktopClient } from '@/renderer/desktop/client'
import { DesktopProvider } from '@/renderer/desktop/DesktopContext'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import { HomePage } from '@/renderer/HomePage/HomePage'
import { desktopRoutes } from '@/renderer/routes'
import { Shell } from '@/renderer/Shell/Shell'
import type { DesktopEvent } from '@/shared/protocol'

/** Where the Shell sends the page, before the screens that fill those places exist. */
export const STUB_ROUTES: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'play/:fileId', element: <p>Playing</p> },
      { path: 'settings', element: <p>Settings page</p> },
    ],
  },
]

type FakeOverrides = Partial<DesktopClient>

/** A client whose calls are recorded; `emit` pushes an event to whoever subscribed. */
export const fakeClient = (overrides: FakeOverrides = {}) => {
  const listeners = new Set<(event: DesktopEvent) => void>()
  const request = mock<DesktopClient['request']>(
    overrides.request ?? (async () => ({ type: 'done' })),
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

export const renderDesktop = ({
  client,
  route = '/',
  routes = desktopRoutes,
}: {
  client: DesktopClient
  route?: string
  routes?: RouteObject[]
}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const menu = createMenuHub()
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  render(
    <QueryClientProvider client={queryClient}>
      <DesktopProvider client={client} menu={menu}>
        <RouterProvider router={router} />
      </DesktopProvider>
    </QueryClientProvider>,
  )
  return { router, menu, queryClient }
}
