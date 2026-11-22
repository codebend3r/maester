import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, renderHook } from '@testing-library/react'
import { useKeyShortcut } from '@/lib/keyboard'

type ShortcutSwitchProps = { isEnabled: boolean }

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

  it('listens only while enabled, and leaves the key to a target that keeps it', () => {
    const press = mock(() => {})
    const kept = document.createElement('button')
    document.body.append(kept)
    const keepsKey = (target: EventTarget | null) => target === kept
    const { rerender, unmount } = renderHook(
      ({ isEnabled }: ShortcutSwitchProps) =>
        useKeyShortcut({ key: 'k', onPress: press, isEnabled, keepsKey }),
      { initialProps: { isEnabled: false } },
    )
    const ignored = new KeyboardEvent('keydown', { key: 'k', cancelable: true })
    window.dispatchEvent(ignored)
    expect(press).not.toHaveBeenCalled()
    expect(ignored.defaultPrevented).toBe(false)
    rerender({ isEnabled: true })
    const left = new KeyboardEvent('keydown', { key: 'k', cancelable: true, bubbles: true })
    kept.dispatchEvent(left)
    expect(press).not.toHaveBeenCalled()
    expect(left.defaultPrevented).toBe(false)
    fireEvent.keyDown(window, { key: 'k' })
    expect(press).toHaveBeenCalledTimes(1)
    unmount()
    kept.remove()
  })
})
