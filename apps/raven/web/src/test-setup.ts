import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import {
  configurePlayerPrefs,
  usePageBackdrop,
  usePlayerPrefs,
  useUnlockPrompt,
} from '@raven/ui/headless'
import { queryClient } from '@/lib/queryClient'
import { useAuthSession } from '@/stores/authSession'
import { useCardLinks } from '@/stores/cardLinks'
import { useHoverBackdrops } from '@/stores/hoverBackdrops'
import { useOriginProbe } from '@/stores/originProbe'
import { useSelectionScopes } from '@/stores/selectionScope'
import { useSideMenu } from '@/stores/sideMenu'
import { useTheme } from '@/stores/theme'
import { resetBrowserSupport } from '@/test/canPlay'
import { FakeEventSource } from '@/test/eventSource'
import { pacePolls, resetPolls } from '@/test/polls'

pacePolls()
await configurePlayerPrefs({ storage: window.localStorage })

const initialAuthSession = useAuthSession.getInitialState()
const initialPrefs = usePlayerPrefs.getInitialState()
const initialPageBackdrop = usePageBackdrop.getInitialState()
const initialSideMenu = useSideMenu.getInitialState()
const initialUnlockPrompt = useUnlockPrompt.getInitialState()
const initialTheme = useTheme.getInitialState()
const initialCardLinks = useCardLinks.getInitialState()
const initialHoverBackdrops = useHoverBackdrops.getInitialState()
const initialOriginProbe = useOriginProbe.getInitialState()
const initialSelectionScopes = useSelectionScopes.getInitialState()

// Bun test does not unmount between tests the way vitest globals do. The
// stores reset after the unmount, or a store still subscribed to redraws
// outside act(). A test file's own afterEach runs before this one, so one
// that resets its api spies calls cleanup() first: a page still mounted
// would refetch from a spy that now answers undefined.
afterEach(() => {
  cleanup()
  queryClient.clear()
  useAuthSession.setState(initialAuthSession, true)
  usePlayerPrefs.setState(initialPrefs, true)
  usePageBackdrop.setState(initialPageBackdrop, true)
  useSideMenu.setState(initialSideMenu, true)
  useUnlockPrompt.setState(initialUnlockPrompt, true)
  useTheme.setState(initialTheme, true)
  useCardLinks.setState(initialCardLinks, true)
  useHoverBackdrops.setState(initialHoverBackdrops, true)
  useOriginProbe.setState(initialOriginProbe, true)
  useSelectionScopes.setState(initialSelectionScopes, true)
  resetBrowserSupport()
  FakeEventSource.opened = []
  resetPolls()
})
