import { describe, expect, it } from 'bun:test'
import { WREN_PAGE_ORIGIN } from '@raven/wren'
import {
  PERMISSIONS,
  WINDOW_OPEN_ACTIONS,
  isPageUrl,
  isPermissionAllowed,
  navigationFor,
  windowOpenFor,
} from '@/main/security'

describe('security', () => {
  it("keeps the window on the web host's page", () => {
    expect(isPageUrl(`${WREN_PAGE_ORIGIN}/album/3`)).toBe(true)
    expect(navigationFor(`${WREN_PAGE_ORIGIN}/settings`)).toEqual({
      isAllowed: true,
      shouldOpenExternally: false,
    })
  })

  it("refuses the page with credentials in its address, and Raven's port", () => {
    expect(isPageUrl('http://user:secret@localhost:47485/')).toBe(false)
    expect(isPageUrl('http://localhost:47484/')).toBe(false)
  })

  it('sends a web address elsewhere to the browser, and anything else nowhere', () => {
    expect(navigationFor('https://wren.maester.tv/')).toEqual({
      isAllowed: false,
      shouldOpenExternally: true,
    })
    expect(navigationFor('file:///etc/hosts')).toEqual({
      isAllowed: false,
      shouldOpenExternally: false,
    })
  })

  it('opens no new window, ever', () => {
    expect(windowOpenFor('https://github.com/')).toEqual({
      action: WINDOW_OPEN_ACTIONS.deny,
      shouldOpenExternally: true,
    })
    expect(windowOpenFor(`${WREN_PAGE_ORIGIN}/album/3`)).toEqual({
      action: WINDOW_OPEN_ACTIONS.deny,
      shouldOpenExternally: false,
    })
  })

  it('grants only the permissions the page needs', () => {
    expect(isPermissionAllowed(PERMISSIONS.fullscreen)).toBe(true)
    expect(isPermissionAllowed(PERMISSIONS.clipboardWrite)).toBe(true)
    expect(isPermissionAllowed('geolocation')).toBe(false)
    expect(isPermissionAllowed('media')).toBe(false)
  })
})
