import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { resetBrowserSupport } from '@/test/canPlay'

const initialPrefs = usePlayerPrefs.getInitialState()

// Bun test does not unmount between tests the way vitest globals do.
afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  resetBrowserSupport()
})
