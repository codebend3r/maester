import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { configureStorage } from '@/stores/configureStorage'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { usePlayerServices } from '@/stores/playerServices'
import { useToasts } from '@/stores/toasts'
import { resetBrowserSupport } from '@/test/canPlay'

await configureStorage({ storage: window.localStorage })

const initialPrefs = usePlayerPrefs.getInitialState()
const initialMediaOrigin = useMediaOrigin.getInitialState()
const initialPageBackdrop = usePageBackdrop.getInitialState()
const initialServices = usePlayerServices.getInitialState()
const initialToasts = useToasts.getInitialState()

afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useMediaOrigin.setState(initialMediaOrigin, true)
  usePageBackdrop.setState(initialPageBackdrop, true)
  usePlayerServices.setState(initialServices, true)
  useToasts.setState(initialToasts, true)
  window.localStorage.clear()
  resetBrowserSupport()
})
