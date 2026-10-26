import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

type RenderQueryHookProps<T> = { hook: () => T; client: QueryClient }

/** Renders `hook` under `client`, as a host's provider hands it the cache. */
export const renderQueryHook = <T,>({ hook, client }: RenderQueryHookProps<T>) => {
  type WrapperProps = { children: ReactNode }

  const wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(hook, { wrapper })
}
