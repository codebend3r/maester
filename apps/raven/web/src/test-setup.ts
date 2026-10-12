import { afterEach } from 'bun:test'
import { timeoutManager } from '@tanstack/react-query'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useSideMenu } from '@/stores/sideMenu'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { resetBrowserSupport } from '@/test/canPlay'
import { FakeEventSource } from '@/test/eventSource'

// A query's poll comes round a hundred times sooner here, so a test that
// waits on one, as for a matching pass to settle, takes milliseconds rather
// than seconds. Set before any query client exists, as TanStack asks.
timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (callback, delay) => setInterval(callback, delay / 100),
  clearInterval: (id) => clearInterval(id),
})

const initialPrefs = usePlayerPrefs.getInitialState()
const initialSideMenu = useSideMenu.getInitialState()
const initialUnlockPrompt = useUnlockPrompt.getInitialState()

// Bun test does not unmount between tests the way vitest globals do.
afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useSideMenu.setState(initialSideMenu, true)
  useUnlockPrompt.setState(initialUnlockPrompt, true)
  resetBrowserSupport()
  FakeEventSource.opened = []
})
