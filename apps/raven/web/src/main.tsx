import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
// Shared primitives load before host components that override them.
import '@raven/ui/styles.css'
import { AppRoutes } from '@/AppRoutes'
import { CardLinks } from '@/components/CardLink/CardLink'
import { MediaOriginProbe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { queryClient } from '@/lib/queryClient'
import { PrefetchPlaybackSettings } from '@/lib/prefetchPlaybackSettings'
import { StartAuthSession } from '@/lib/startAuthSession'
import { followTheme } from '@/stores/theme'

followTheme()
const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <StartAuthSession>
            <PrefetchPlaybackSettings>
              <MediaOriginProbe>
                <CardLinks>
                  <AppRoutes />
                </CardLinks>
              </MediaOriginProbe>
            </PrefetchPlaybackSettings>
          </StartAuthSession>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}
