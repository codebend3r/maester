import { isRavenDesktopBridge } from '@raven/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
// Shared primitives load before host components that override them.
import '@raven/ui/styles.css'
import { configureStorage } from '@raven/ui/headless'
import { AppRoutes } from '@/AppRoutes'
import { startMediaOrigin } from '@/lib/apiOrigin'
import { applyStylesheets } from '@/lib/applyStylesheets'
import { CardLinks } from '@/components/CardLink/CardLink'
import { startDesktop } from '@/desktop/startDesktop'
import { startServiceWorker } from '@/lib/serviceWorker'
import { KeepLibraryListings } from '@/lib/keepLibraryListings'
import { queryClient } from '@/lib/queryClient'
import { keepAuthConfigSaved, restoreAuthConfig } from '@/lib/savedAuthConfig'
import { PrefetchPlaybackSettings } from '@/lib/prefetchPlaybackSettings'
import { StartAuthSession } from '@/lib/startAuthSession'
import { followTheme } from '@/stores/theme'

followTheme()
startMediaOrigin()
restoreAuthConfig({ storage: window.localStorage, queryClient })
keepAuthConfigSaved({ storage: window.localStorage, queryClient })
startDesktop({ bridge: window.ravenDesktop, root: document.documentElement, target: window })
startServiceWorker({
  target: window,
  isProduction: import.meta.env.PROD,
  isDesktop: isRavenDesktopBridge(window.ravenDesktop),
})
await Promise.all([
  configureStorage({ storage: window.localStorage }),
  applyStylesheets({ root: document }),
])
const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <StartAuthSession>
            <PrefetchPlaybackSettings>
              <KeepLibraryListings>
                <CardLinks>
                  <AppRoutes />
                </CardLinks>
              </KeepLibraryListings>
            </PrefetchPlaybackSettings>
          </StartAuthSession>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}
