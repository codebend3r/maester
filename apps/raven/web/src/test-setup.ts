import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import {
  configureStorage,
  usePageBackdrop,
  usePlayerPrefs,
  useUnlockPrompt,
} from '@raven/ui/headless'
import { useToasts } from '@raven/ui'
import { queryClient } from '@/lib/queryClient'
import { useAuthSession } from '@/stores/authSession'
import { useBinge } from '@/stores/binge'
import { useCardLinks } from '@/stores/cardLinks'
import { useDesktopBridge } from '@/stores/desktop'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { useDragging } from '@/stores/dragging'
import { useHoverBackdrops } from '@/stores/hoverBackdrops'
import { useOriginProbe } from '@/stores/originProbe'
import { useSelectionScopes } from '@/stores/selectionScope'
import { useServerReach } from '@/stores/serverReach'
import { useSideMenu } from '@/stores/sideMenu'
import { useTheme } from '@/stores/theme'
import { useWindowChrome } from '@/stores/windowChrome'
import { failOnActWarnings, listenForActWarnings, settleAsyncHelpers } from '@/test/act'
import { resetBrowserSupport } from '@/test/canPlay'
import { FakeEventSource } from '@/test/eventSource'
import { pacePolls, resetPolls } from '@/test/polls'

pacePolls()
settleAsyncHelpers()
listenForActWarnings()
await configureStorage({ storage: window.localStorage })

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
const initialDesktopBridge = useDesktopBridge.getInitialState()
const initialDownloadAsk = useDownloadAsk.getInitialState()
const initialDragging = useDragging.getInitialState()
const initialServerReach = useServerReach.getInitialState()
const initialToasts = useToasts.getInitialState()
const initialWindowChrome = useWindowChrome.getInitialState()

// Bun test does not unmount between tests the way vitest globals do. The
// stores reset after the unmount, or a store still subscribed to redraws
// outside act(). A test file's own afterEach runs before this one, so one
// that resets its api spies calls cleanup() first: a page still mounted
// would refetch from a spy that now answers undefined.
afterEach(() => {
  cleanup()
  queryClient.clear()
  useAuthSession.setState(initialAuthSession, true)
  useBinge.setState({ profiles: [] })
  usePlayerPrefs.setState(initialPrefs, true)
  usePageBackdrop.setState(initialPageBackdrop, true)
  useSideMenu.setState(initialSideMenu, true)
  useUnlockPrompt.setState(initialUnlockPrompt, true)
  useTheme.setState(initialTheme, true)
  useCardLinks.setState(initialCardLinks, true)
  useHoverBackdrops.setState(initialHoverBackdrops, true)
  useOriginProbe.setState(initialOriginProbe, true)
  useSelectionScopes.setState(initialSelectionScopes, true)
  useDesktopBridge.setState(initialDesktopBridge, true)
  useDownloadAsk.setState(initialDownloadAsk, true)
  useDragging.setState(initialDragging, true)
  useServerReach.setState(initialServerReach, true)
  useToasts.setState(initialToasts, true)
  useWindowChrome.setState(initialWindowChrome, true)
  delete document.documentElement.dataset.desktop
  resetBrowserSupport()
  FakeEventSource.opened = []
  resetPolls()
  failOnActWarnings()
})
