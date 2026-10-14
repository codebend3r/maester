import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
import { AppRoutes } from '@/AppRoutes'
import { createQueryClient } from '@/lib/queryClient'
import { SharedPlaybackPolicy } from '@/lib/sharedPlaybackPolicy'
import '@/styles/globals.scss'
import '@/styles/elements.scss'

const queryClient = createQueryClient()
const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SharedPlaybackPolicy>
            <AppRoutes />
          </SharedPlaybackPolicy>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}
