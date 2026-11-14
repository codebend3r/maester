import { describe, expect, it } from 'bun:test'
import { DESKTOP_PLATFORMS } from '@raven/core'
import { DESKTOP_ENV, desktopPlatformFor } from '@/shared/platform'

describe('desktopPlatformFor', () => {
  it("reads Node's win32 as Windows and anything else as macOS", () => {
    expect(desktopPlatformFor({ platform: 'win32' })).toBe(DESKTOP_PLATFORMS.windows)
    expect(desktopPlatformFor({ platform: 'darwin' })).toBe(DESKTOP_PLATFORMS.mac)
  })
})

describe('DESKTOP_ENV', () => {
  it('names the build environment', () => {
    expect(DESKTOP_ENV).toEqual({
      serverOrigin: 'RAVEN_DESKTOP_SERVER_ORIGIN',
      linkOrigins: 'RAVEN_DESKTOP_LINK_ORIGINS',
    })
  })
})
