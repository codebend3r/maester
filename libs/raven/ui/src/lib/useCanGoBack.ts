import { useLocation } from 'react-router-dom'

const LOCATION_KEYS = { default: 'default' } as const

const hasHistoryIndex = (state: unknown): state is { idx: number } =>
  typeof state === 'object' && state !== null && 'idx' in state && typeof state.idx === 'number'

/**
 * Whether the app has a page of its own behind this one. The browser router
 * keeps each entry's index in `history.state`, which survives reloads and
 * `replace`; a memory router (the desktop app, the tests) writes none, so
 * its location key stands in. The key alone misreads a deep link that
 * replaced its URL, as `replace` gives the first entry a fresh key.
 */
export const useCanGoBack = (): boolean => {
  const key = useLocation().key
  const state: unknown = window.history.state
  if (hasHistoryIndex(state)) return state.idx > 0
  return key !== LOCATION_KEYS.default
}
