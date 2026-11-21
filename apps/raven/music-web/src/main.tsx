import { startMediaOrigin } from '@raven/ui'
import { configureStorage } from '@raven/ui/headless'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans'
import '@/styles/globals.scss'
import { AppRoutes } from '@/AppRoutes'
import { queryClient } from '@/lib/queryClient'
import { StartAuthSession } from '@/lib/startAuthSession'
import { followAppearance } from '@/stores/wrenPrefs'

followAppearance()
// raven's origin when this page's `/api` is a proxy to it (Netlify's); unset when `/api` is raven itself.
startMediaOrigin({ apiOrigin: import.meta.env.VITE_API_ORIGIN ?? '' })
// The queue and the player's choices are read back before any route draws, as the apps read their stores.
await configureStorage({ storage: window.localStorage })
const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <StartAuthSession>
            <AppRoutes />
          </StartAuthSession>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}
