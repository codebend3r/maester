import { describe, expect, it } from 'bun:test'
import {
  DESKTOP_PLATFORMS,
  isRavenDesktopBridge,
  WINDOW_CHROMES,
  windowChromeFor,
} from '@/desktop/bridge'

const noop = () => undefined
const bridge = {
  request: noop,
  dropFiles: noop,
  subscribe: noop,
  platform: DESKTOP_PLATFORMS.mac,
}

describe('isRavenDesktopBridge', () => {
  it('accepts the three bridge functions and a platform', () => {
    expect(isRavenDesktopBridge(bridge)).toBe(true)
    expect(isRavenDesktopBridge({ ...bridge, platform: DESKTOP_PLATFORMS.windows })).toBe(true)
  })

  it('refuses anything missing a function or holding something else in its place', () => {
    expect(isRavenDesktopBridge(undefined)).toBe(false)
    expect(isRavenDesktopBridge(null)).toBe(false)
    expect(isRavenDesktopBridge('bridge')).toBe(false)
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop, platform: 'mac' })).toBe(false)
    expect(isRavenDesktopBridge({ ...bridge, subscribe: 'no' })).toBe(false)
  })

  it('refuses a missing or unknown platform', () => {
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop, subscribe: noop })).toBe(false)
    expect(isRavenDesktopBridge({ ...bridge, platform: 'linux' })).toBe(false)
    expect(isRavenDesktopBridge({ ...bridge, platform: 'win32' })).toBe(false)
  })
})

describe('windowChromeFor', () => {
  it('draws the controls in the page on Windows and leaves them to macOS elsewhere', () => {
    expect(windowChromeFor({ platform: DESKTOP_PLATFORMS.windows })).toBe(WINDOW_CHROMES.drawn)
    expect(windowChromeFor({ platform: DESKTOP_PLATFORMS.mac })).toBe(WINDOW_CHROMES.inset)
  })
})
