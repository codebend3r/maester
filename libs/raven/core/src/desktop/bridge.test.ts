import { describe, expect, it } from 'bun:test'
import { isRavenDesktopBridge } from '@/desktop/bridge'

const noop = () => undefined

describe('isRavenDesktopBridge', () => {
  it('accepts an object with the three bridge functions', () => {
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop, subscribe: noop })).toBe(true)
  })

  it('refuses anything missing a function or holding something else in its place', () => {
    expect(isRavenDesktopBridge(undefined)).toBe(false)
    expect(isRavenDesktopBridge(null)).toBe(false)
    expect(isRavenDesktopBridge('bridge')).toBe(false)
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop })).toBe(false)
    expect(isRavenDesktopBridge({ request: noop, dropFiles: noop, subscribe: 'no' })).toBe(false)
  })
})
