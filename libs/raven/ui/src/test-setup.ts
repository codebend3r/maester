import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { resetBrowserSupport } from '@/test/canPlay'

const initialPrefs = usePlayerPrefs.getInitialState()

afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  resetBrowserSupport()
})
