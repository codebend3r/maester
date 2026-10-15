import { describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useFullscreen, useLeaveFullscreen } from '@/components/Player/useStageChrome'

describe('useFullscreen', () => {
  it('enters and exits the page fullscreen and follows its change event', () => {
    const enter = mock(async () => {})
    const exit = mock(async () => {})
    const originalEnter = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'requestFullscreen',
    )
    const originalExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: enter,
      configurable: true,
    })
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true })
    const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    try {
      const { result, unmount } = renderHook(() => {
        useLeaveFullscreen()
        return useFullscreen()
      })
      act(() => result.current.toggle())
      expect(enter).toHaveBeenCalledTimes(1)
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.documentElement,
        configurable: true,
      })
      act(() => document.dispatchEvent(new Event('fullscreenchange')))
      expect(result.current.fullscreen).toBe(true)
      act(() => result.current.toggle())
      expect(exit).toHaveBeenCalledTimes(1)
      unmount()
      expect(exit).toHaveBeenCalledTimes(2)
    } finally {
      Object.defineProperty(
        document,
        'fullscreenElement',
        original ?? { value: null, configurable: true },
      )
      if (originalEnter)
        Object.defineProperty(document.documentElement, 'requestFullscreen', originalEnter)
      else Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
      if (originalExit) Object.defineProperty(document, 'exitFullscreen', originalExit)
      else Reflect.deleteProperty(document, 'exitFullscreen')
    }
  })
})
