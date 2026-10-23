import { createQueryClient } from '@raven/ui/headless'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/**
 * The app's query client for a screen test. A query no screen holds would keep a
 * garbage-collection timer for minutes, which holds jest open, so here it is kept for good.
 */
export const createScreenClient = (): QueryClient => {
  const client = createQueryClient()
  const defaults = client.getDefaultOptions()
  client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, gcTime: Infinity } })
  return client
}

/** Renders a screen as the app does: inside the safe area, with a query client. */
export const renderScreen = async ({
  ui,
  client = createScreenClient(),
}: {
  ui: ReactElement
  client?: QueryClient
}) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  )
