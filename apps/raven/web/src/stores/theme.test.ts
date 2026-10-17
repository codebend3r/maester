import { afterEach, describe, expect, it } from 'bun:test'
import { THEME_KEY, followTheme, useTheme } from '@/stores/theme'

const initial = useTheme.getInitialState()

afterEach(() => {
  window.localStorage.clear()
  useTheme.setState(initial, true)
  delete document.documentElement.dataset.theme
})

describe('useTheme', () => {
  it('wears a picked theme at once and keeps it on this device', () => {
    useTheme.getState().pick('patina')
    expect(useTheme.getState().theme).toBe('patina')
    expect(document.documentElement.dataset.theme).toBe('patina')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('patina')
  })
})

describe('followTheme', () => {
  it('wears the saved theme, then follows one picked in another tab', () => {
    const stop = followTheme()
    expect(document.documentElement.dataset.theme).toBe('verdigris')

    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'mint' }))
    expect(useTheme.getState().theme).toBe('mint')
    expect(document.documentElement.dataset.theme).toBe('mint')

    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'sepia' }))
    expect(useTheme.getState().theme).toBe('verdigris')

    stop()
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'bronze' }))
    expect(useTheme.getState().theme).toBe('verdigris')
  })

  it('leaves other keys alone', () => {
    const stop = followTheme()
    window.dispatchEvent(new StorageEvent('storage', { key: 'raven-side-menu', newValue: 'x' }))
    expect(useTheme.getState().theme).toBe('verdigris')
    stop()
  })
})
