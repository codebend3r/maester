import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { configurePlayerPrefs, usePlayerPrefs } from '@/stores/playerPrefs'
import { usePlayerServices } from '@/stores/playerServices'
import { useToasts } from '@/stores/toasts'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { resetBrowserSupport } from '@/test/canPlay'

await configurePlayerPrefs({ storage: window.localStorage })

const initialPrefs = usePlayerPrefs.getInitialState()
const initialMediaOrigin = useMediaOrigin.getInitialState()
const initialPageBackdrop = usePageBackdrop.getInitialState()
const initialServices = usePlayerServices.getInitialState()
const initialToasts = useToasts.getInitialState()
const initialUnlockPrompt = useUnlockPrompt.getInitialState()

afterEach(() => {
  cleanup()
  usePlayerPrefs.setState(initialPrefs, true)
  useMediaOrigin.setState(initialMediaOrigin, true)
  usePageBackdrop.setState(initialPageBackdrop, true)
  usePlayerServices.setState(initialServices, true)
  useToasts.setState(initialToasts, true)
  useUnlockPrompt.setState(initialUnlockPrompt, true)
  window.sessionStorage.clear()
  resetBrowserSupport()
})
