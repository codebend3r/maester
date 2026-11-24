import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useActiveServer } from '@/stores/activeServer'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { configureStorage } from '@/stores/configureStorage'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { usePlayerServices } from '@/stores/playerServices'
import { useToasts } from '@/stores/toasts'
import { failOnActWarnings, listenForActWarnings, settleAsyncHelpers } from '@tooling/web/act'
import { resetBrowserSupport } from '@/test/canPlay'

settleAsyncHelpers()
listenForActWarnings()
await configureStorage({ storage: window.localStorage })

const initialPrefs = usePlayerPrefs.getInitialState()
const initialMediaOrigin = useMediaOrigin.getInitialState()
const initialActiveServer = useActiveServer.getInitialState()
const initialServices = usePlayerServices.getInitialState()
const initialToasts = useToasts.getInitialState()

afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useMediaOrigin.setState(initialMediaOrigin, true)
  useActiveServer.setState(initialActiveServer, true)
  usePlayerServices.setState(initialServices, true)
  useToasts.setState(initialToasts, true)
  window.localStorage.clear()
  resetBrowserSupport()
  failOnActWarnings()
})
