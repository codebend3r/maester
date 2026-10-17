import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
// Shared primitives load before the desktop overrides.
import '@raven/ui/styles.css'
import '@/renderer/styles/desktop.scss'
import { clientFor } from '@/renderer/desktop/client'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import { listenForPlayer } from '@/renderer/desktop/playerConnection'
import { desktopRoutes } from '@/renderer/routes'
import { useDesktopBridge } from '@/renderer/stores/desktop'
import { APP_ORIGIN } from '@/shared/protocol'

const client = clientFor('ravenDesktop' in window ? window.ravenDesktop : undefined)
// Listening before the first render, so the hand-over that answers the Shell's `ready` is heard.
const player = listenForPlayer({ target: window, origin: APP_ORIGIN })
const rootElement = document.getElementById('root')

if (rootElement) {
  const root = createRoot(rootElement)
  if (client === null) {
    root.render(
      <main>
        <h1>raven player could not start</h1>
      </main>,
    )
  } else {
    // Before the first render, so every component that reads the bridge finds it.
    useDesktopBridge.setState({ desktop: { client, menu: createMenuHub(), player } })
    root.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={createMemoryRouter(desktopRoutes)} />
        </QueryClientProvider>
      </StrictMode>,
    )
  }
}
