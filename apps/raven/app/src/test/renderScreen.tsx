import { expect } from '@jest/globals'
import { createQueryClient } from '@raven/ui/headless'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/**
 * The app's query client for a screen test. A query no screen holds would keep a
 * garbage-collection timer for minutes, which holds jest open, so here it is kept for good.
 * So is a mutation: while one is pending, query-core arms its timer again on the real clock,
 * so a write a test holds unanswered would keep jest open for as long.
 */
export const createScreenClient = (): QueryClient => {
  const client = createQueryClient()
  const defaults = client.getDefaultOptions()
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, gcTime: Infinity },
    mutations: { ...defaults.mutations, gcTime: Infinity },
  })
  return client
}

/**
 * Waits until `client` is neither reading nor writing, so no answer lands after the test, out
 * of `act`.
 */
export const untilIdle = async (client: QueryClient): Promise<void> =>
  waitFor(() => expect(client.isFetching() + client.isMutating()).toBe(0))

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

/** A host element, as the screen's queries hand it back. */
type ScreenNode = ReturnType<typeof screen.getByRole>

/** The host component a React Native scroll view draws. */
const SCROLL_VIEW_HOST = 'RCTScrollView'

/**
 * What each scroll view holding `node` does with a tap while the keyboard is up, nearest first.
 * One keeps the tap for its children only when told to (`handled`); otherwise the first tap
 * only puts the keyboard away.
 */
export const keyboardTapsAbove = (node: ScreenNode): unknown[] => {
  const { parent } = node
  if (parent === null) return []
  const here = parent.type === SCROLL_VIEW_HOST ? [parent.props.keyboardShouldPersistTaps] : []
  return [...here, ...keyboardTapsAbove(parent)]
}
