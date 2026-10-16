import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { usePlayerPrefs } from '@raven/ui'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { useSideMenu } from '@/stores/sideMenu'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { resetBrowserSupport } from '@/test/canPlay'
import { FakeEventSource } from '@/test/eventSource'
import { pacePolls, resetPolls } from '@/test/polls'

pacePolls()

const initialPrefs = usePlayerPrefs.getInitialState()
const initialPageBackdrop = usePageBackdrop.getInitialState()
const initialSideMenu = useSideMenu.getInitialState()
const initialUnlockPrompt = useUnlockPrompt.getInitialState()

// Bun test does not unmount between tests the way vitest globals do. The
// stores reset after the unmount, or a store still subscribed to redraws
// outside act(). A test file's own afterEach runs before this one, so one
// that resets its api spies calls cleanup() first: a page still mounted
// would refetch from a spy that now answers undefined.
afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  usePageBackdrop.setState(initialPageBackdrop, true)
  useSideMenu.setState(initialSideMenu, true)
  useUnlockPrompt.setState(initialUnlockPrompt, true)
  resetBrowserSupport()
  FakeEventSource.opened = []
  resetPolls()
})
