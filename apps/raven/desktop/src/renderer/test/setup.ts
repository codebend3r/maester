import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { configurePlayerPrefs } from '@raven/ui'
import { useDesktopBridge } from '@/renderer/stores/desktop'
import { useDownloadAsk } from '@/renderer/stores/downloadAsk'
import { useDragging } from '@/renderer/stores/dragging'
import { useNotice } from '@/renderer/stores/notice'
import { useUpdateNotice } from '@/renderer/stores/updateNotice'

await configurePlayerPrefs({ storage: window.localStorage })

// Bun test does not unmount between tests the way vitest globals do.
afterEach(() => {
  cleanup()
  // The stores are module singletons, so no test leaves its state to the next.
  useDesktopBridge.setState(useDesktopBridge.getInitialState(), true)
  useDownloadAsk.setState(useDownloadAsk.getInitialState(), true)
  useDragging.setState(useDragging.getInitialState(), true)
  useNotice.setState(useNotice.getInitialState(), true)
  useUpdateNotice.setState(useUpdateNotice.getInitialState(), true)
})
