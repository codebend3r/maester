import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { resetBrowserSupport } from '@/test/canPlay'

const initialPrefs = usePlayerPrefs.getInitialState()
const initialMediaOrigin = useMediaOrigin.getInitialState()

afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useMediaOrigin.setState(initialMediaOrigin, true)
  window.sessionStorage.clear()
  resetBrowserSupport()
})
