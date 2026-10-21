import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Renders `hook` under `client`, as a host's provider hands it the cache. */
export const renderQueryHook = <T,>({ hook, client }: { hook: () => T; client: QueryClient }) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(hook, { wrapper })
}
