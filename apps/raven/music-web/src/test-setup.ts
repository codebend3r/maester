import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { configureStorage, useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { queryClient } from '@/lib/queryClient'
import { useAuthSession } from '@/stores/authSession'
import { useRecentSearches } from '@/stores/recentSearches'
import { useToast } from '@/stores/toast'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { failOnActWarnings, listenForActWarnings, settleAsyncHelpers } from '@tooling/web/act'
import { resetViewport } from '@/test/viewport'

settleAsyncHelpers()
listenForActWarnings()
await configureStorage({ storage: window.localStorage })

const initialAuthSession = useAuthSession.getInitialState()
const initialAudioQueue = useAudioQueue.getInitialState()
const initialPlayerPrefs = usePlayerPrefs.getInitialState()
const initialRecentSearches = useRecentSearches.getInitialState()
const initialWrenPrefs = useWrenPrefs.getInitialState()

/*
 * Bun test does not unmount between tests the way vitest globals do. The stores reset after the
 * unmount, or a store still subscribed to redraws outside act(). A test file's own afterEach
 * runs before this one, so one that resets its api spies calls cleanup() first.
 */
afterEach(() => {
  cleanup()
  queryClient.clear()
  useToast.getState().hide()
  useAuthSession.setState(initialAuthSession, true)
  useAudioQueue.setState(initialAudioQueue, true)
  usePlayerPrefs.setState(initialPlayerPrefs, true)
  useRecentSearches.setState(initialRecentSearches, true)
  useWrenPrefs.setState(initialWrenPrefs, true)
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  resetViewport()
  failOnActWarnings()
})
