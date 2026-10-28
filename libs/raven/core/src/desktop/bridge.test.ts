import { describe, expect, it } from 'bun:test'
import { isRavenDesktopBridge, WINDOW_CHROMES, windowChromeFor } from '@/desktop/bridge'

const noop = () => undefined
const bridge = {
  request: noop,
  dropFiles: noop,
  subscribe: noop,
  windowChrome: WINDOW_CHROMES.inset,
}

describe('isRavenDesktopBridge', () => {
  it('accepts the three bridge functions and a window chrome', () => {
    expect(isRavenDesktopBridge(bridge)).toBe(true)
    expect(isRavenDesktopBridge({ ...bridge, windowChrome: WINDOW_CHROMES.drawn })).toBe(true)
  })

  it('refuses anything missing a function or holding something else in its place', () => {
    expect(isRavenDesktopBridge(undefined)).toBe(false)
    expect(isRavenDesktopBridge(null)).toBe(false)
    expect(isRavenDesktopBridge('bridge')).toBe(false)
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop, windowChrome: 'inset' })).toBe(
      false,
    )
    expect(isRavenDesktopBridge({ ...bridge, subscribe: 'no' })).toBe(false)
  })

  it('refuses a missing or unknown window chrome', () => {
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop, subscribe: noop })).toBe(false)
    expect(isRavenDesktopBridge({ ...bridge, windowChrome: 'frame' })).toBe(false)
  })
})

describe('windowChromeFor', () => {
  it('draws the controls in the page on Windows and leaves them to macOS elsewhere', () => {
    expect(windowChromeFor({ platform: 'win32' })).toBe(WINDOW_CHROMES.drawn)
    expect(windowChromeFor({ platform: 'darwin' })).toBe(WINDOW_CHROMES.inset)
  })
})
