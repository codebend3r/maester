import { afterEach } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useDesktopBridge } from '@/renderer/stores/desktop'
import { useDragging } from '@/renderer/stores/dragging'
import { useNotice } from '@/renderer/stores/notice'
import { useUpdateNotice } from '@/renderer/stores/updateNotice'

// Bun test does not unmount between tests the way vitest globals do.
afterEach(() => {
  cleanup()
  // The stores are module singletons, so no test leaves its state to the next.
  useDesktopBridge.setState(useDesktopBridge.getInitialState(), true)
  useDragging.setState(useDragging.getInitialState(), true)
  useNotice.setState(useNotice.getInitialState(), true)
  useUpdateNotice.setState(useUpdateNotice.getInitialState(), true)
})
