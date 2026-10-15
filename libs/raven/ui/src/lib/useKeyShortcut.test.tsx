import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, renderHook } from '@testing-library/react'
import { useKeyShortcut } from '@/lib/keyboard'

describe('useKeyShortcut', () => {
  it('handles its unmodified key and removes the listener on unmount', () => {
    const press = mock(() => {})
    const { unmount } = renderHook(() => useKeyShortcut({ key: 'k', onPress: press }))
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(press).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'K' })
    expect(press).toHaveBeenCalledTimes(1)
    unmount()
    fireEvent.keyDown(window, { key: 'k' })
    expect(press).toHaveBeenCalledTimes(1)
  })
})
