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
import { DesktopProvider } from '@/renderer/desktop/DesktopContext'
import { createMenuHub } from '@/renderer/desktop/menuHub'
import { desktopRoutes } from '@/renderer/routes'

const client = clientFor('ravenDesktop' in window ? window.ravenDesktop : undefined)
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
    root.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <DesktopProvider client={client} menu={createMenuHub()}>
            <RouterProvider router={createMemoryRouter(desktopRoutes)} />
          </DesktopProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
  }
}
