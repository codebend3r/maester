import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useSideMenu } from '@/stores/sideMenu'
import { resetBrowserSupport } from '@/test/canPlay'
import { FakeEventSource } from '@/test/eventSource'

const initialPrefs = usePlayerPrefs.getInitialState()
const initialSideMenu = useSideMenu.getInitialState()

// Bun test does not unmount between tests the way vitest globals do.
afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useSideMenu.setState(initialSideMenu, true)
  resetBrowserSupport()
  FakeEventSource.opened = []
})
