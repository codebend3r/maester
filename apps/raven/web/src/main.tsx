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
import { createQueryClient } from '@/lib/queryClient'
import { SharedPlaybackPolicy } from '@/lib/sharedPlaybackPolicy'

const queryClient = createQueryClient()
const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SharedPlaybackPolicy>
            <CardLinks>
              <AppRoutes />
            </CardLinks>
          </SharedPlaybackPolicy>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}
