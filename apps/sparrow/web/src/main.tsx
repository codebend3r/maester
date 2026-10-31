import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
import { ChatPage } from '@/pages/ChatPage/ChatPage'
import '@/styles/globals.scss'

// A failed sign-in check or sandbox lookup is shown, not retried behind a spinner.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ChatPage />
      </QueryClientProvider>
    </StrictMode>,
  )
}
