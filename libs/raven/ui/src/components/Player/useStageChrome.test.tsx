import { describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useBezel, useFullscreen, useLeaveFullscreen } from '@/components/Player/useStageChrome'

describe('useBezel', () => {
  it('flashes for the bezel animation and restarts with each flash', async () => {
    const { result } = renderHook(() => useBezel())
    expect(result.current.isFlashing).toBe(false)
    act(() => result.current.flash({ icon: 'forward', text: 'Forward 10s' }))
    expect(result.current.isFlashing).toBe(true)
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    act(() => result.current.flash({ icon: 'forward', text: 'Forward 20s' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(result.current.isFlashing).toBe(true)
    expect(result.current.bezel?.text).toBe('Forward 20s')
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(result.current.isFlashing).toBe(false)
  })
})

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
