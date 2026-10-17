import { describe, expect, it } from 'bun:test'
import { detectSystem, isOperatingSystem, systemOf } from '@/pages/GetPage/platforms'

const AGENTS = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
} as const

describe('systemOf', () => {
  it('reads macOS, Windows and Linux off their browsers', () => {
    expect(systemOf(AGENTS.mac)).toBe('mac')
    expect(systemOf(AGENTS.windows)).toBe('windows')
    expect(systemOf(AGENTS.linux)).toBe('linux')
  })

  it('offers no system to a phone, a tablet or a Chromebook', () => {
    expect(systemOf(AGENTS.android)).toBeUndefined()
    expect(systemOf(AGENTS.iphone)).toBeUndefined()
    expect(systemOf(AGENTS.ipad)).toBeUndefined()
    expect(systemOf(AGENTS.chromebook)).toBeUndefined()
  })

  it('offers none for an agent it cannot place', () => {
    expect(systemOf('')).toBeUndefined()
    expect(systemOf('curl/8.7.1')).toBeUndefined()
  })
})

describe('detectSystem', () => {
  it('takes the system ?os= names over the browser', () => {
    expect(detectSystem({ query: 'linux', userAgent: AGENTS.mac })).toBe('linux')
    expect(detectSystem({ query: 'mac', userAgent: AGENTS.iphone })).toBe('mac')
  })

  it('falls back to the browser when ?os= is missing or names no system', () => {
    expect(detectSystem({ query: null, userAgent: AGENTS.windows })).toBe('windows')
    expect(detectSystem({ query: 'beos', userAgent: AGENTS.windows })).toBe('windows')
    expect(detectSystem({ query: '', userAgent: AGENTS.android })).toBeUndefined()
  })
})

describe('isOperatingSystem', () => {
  it('knows the three systems by their ?os= names alone', () => {
    expect(isOperatingSystem('windows')).toBe(true)
    expect(isOperatingSystem('Windows')).toBe(false)
    expect(isOperatingSystem(undefined)).toBe(false)
  })
})
