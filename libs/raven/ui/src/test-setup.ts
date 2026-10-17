import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { usePlayerServices } from '@/stores/playerServices'
import { resetBrowserSupport } from '@/test/canPlay'

const initialPrefs = usePlayerPrefs.getInitialState()
const initialMediaOrigin = useMediaOrigin.getInitialState()
const initialServices = usePlayerServices.getInitialState()

afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useMediaOrigin.setState(initialMediaOrigin, true)
  usePlayerServices.setState(initialServices, true)
  window.sessionStorage.clear()
  resetBrowserSupport()
})
