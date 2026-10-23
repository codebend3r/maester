import type { QueryClient } from '@tanstack/react-query'

type ActiveId = { activeId: string | null }

/**
 * Empties the query cache the moment the active server changes. Every server answers under
 * the same keys, so what one server said must never be shown as another's. zustand calls its
 * listeners inside `set`, before React renders again, so no screen reads the old answers,
 * and a fetch still on its way from the old server lands in a query no one holds.
 */
export const clearOnServerSwitch = ({
  client,
  store,
}: {
  client: Pick<QueryClient, 'clear'>
  store: { subscribe: (listener: (state: ActiveId, previous: ActiveId) => void) => () => void }
}): (() => void) =>
  store.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId) client.clear()
  })
