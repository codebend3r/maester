import type { QueryClient } from '@tanstack/react-query'

type ActiveId = { activeId: string | null }

type SignedIn = { signedIn: Readonly<Record<string, boolean>> }

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

/**
 * Empties the query cache the moment the active server's account signs out, from Settings or
 * because Auth refused its session, so the next account signed in there never sees this one's
 * answers. Only the active server's answers are ever in the cache, so another server's sign out
 * leaves it as it is.
 */
export const clearOnSignOut = ({
  client,
  accounts,
  activeId,
}: {
  client: Pick<QueryClient, 'clear'>
  accounts: { subscribe: (listener: (state: SignedIn, previous: SignedIn) => void) => () => void }
  activeId: () => string | null
}): (() => void) =>
  accounts.subscribe((state, previous) => {
    const id = activeId()
    if (id !== null && previous.signedIn[id] === true && state.signedIn[id] !== true) {
      client.clear()
    }
  })
