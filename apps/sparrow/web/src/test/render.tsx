import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Renders `ui` with a fresh query client that never retries, so a failure shows at once. */
export const renderWithQueries = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )

/** A server-sent event stream's body, one block per `[name, data]` pair. */
export const eventStream = (events: [string, unknown][]): string =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
