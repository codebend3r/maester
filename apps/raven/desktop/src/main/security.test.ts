import { describe, expect, it } from 'bun:test'
import {
  isExternalLink,
  isPageUrl,
  isPermissionAllowed,
  isTrustedSender,
  navigationFor,
  PERMISSIONS,
  windowOpenFor,
} from '@/main/security'

describe('isPageUrl', () => {
  it('accepts only the web host on http://localhost:47484', () => {
    expect(isPageUrl('http://localhost:47484/')).toBe(true)
    expect(isPageUrl('http://localhost:47484')).toBe(true)
    expect(isPageUrl('http://localhost:47484/watch/12?at=30')).toBe(true)
    expect(isPageUrl('http://LOCALHOST:47484/sign-in')).toBe(true)
  })

  it.each([
    'https://localhost:47484/',
    'http://localhost:47485/',
    'http://localhost/',
    'http://127.0.0.1:47484/',
    'http://[::1]:47484/',
    'http://localhost.evil:47484/',
    'http://evil@localhost:47484/',
    'http://user:pass@localhost:47484/',
    'app://raven/',
    'raven-file://raven/',
    'file:///etc/hosts',
    'about:blank',
    'not a url',
    '',
  ])('refuses %p', (url) => {
    expect(isPageUrl(url)).toBe(false)
  })
})

describe('isExternalLink', () => {
  it('is true for http and https only', () => {
    expect(isExternalLink('https://example.com/a')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
    expect(isExternalLink('file:///x')).toBe(false)
    expect(isExternalLink('javascript:alert(1)')).toBe(false)
    expect(isExternalLink('raven://play')).toBe(false)
    expect(isExternalLink('')).toBe(false)
  })
})

describe('windowOpenFor', () => {
  it('always denies and opens only http and https elsewhere externally', () => {
    expect(windowOpenFor('https://www.themoviedb.org/movie/1')).toEqual({
      action: 'deny',
      shouldOpenExternally: true,
    })
    expect(windowOpenFor('http://example.com')).toEqual({
      action: 'deny',
      shouldOpenExternally: true,
    })
    expect(windowOpenFor('about:blank')).toEqual({ action: 'deny', shouldOpenExternally: false })
    expect(windowOpenFor('file:///x')).toEqual({ action: 'deny', shouldOpenExternally: false })
    expect(windowOpenFor('')).toEqual({ action: 'deny', shouldOpenExternally: false })
  })

  it('never hands the page itself to the browser', () => {
    expect(windowOpenFor('http://localhost:47484/library/1')).toEqual({
      action: 'deny',
      shouldOpenExternally: false,
    })
  })
})

describe('navigationFor', () => {
  it('keeps the page on its own origin', () => {
    expect(navigationFor('http://localhost:47484/sign-in')).toEqual({
      isAllowed: true,
      shouldOpenExternally: false,
    })
  })

  it('sends any other web address to the browser instead', () => {
    expect(navigationFor('https://www.imdb.com/name/nm1/')).toEqual({
      isAllowed: false,
      shouldOpenExternally: true,
    })
    expect(navigationFor('http://127.0.0.1:47484/')).toEqual({
      isAllowed: false,
      shouldOpenExternally: true,
    })
  })

  it('stops the rest without opening them', () => {
    expect(navigationFor('file:///etc/hosts')).toEqual({
      isAllowed: false,
      shouldOpenExternally: false,
    })
    expect(navigationFor('app://raven/')).toEqual({ isAllowed: false, shouldOpenExternally: false })
  })
})

describe('isPermissionAllowed', () => {
  it("allows fullscreen and the web app's clipboard writes, and nothing else", () => {
    expect(isPermissionAllowed(PERMISSIONS.fullscreen)).toBe(true)
    expect(isPermissionAllowed(PERMISSIONS.clipboardWrite)).toBe(true)
    expect(PERMISSIONS.clipboardWrite).toBe('clipboard-sanitized-write')
    expect(
      ['media', 'notifications', 'clipboard-read', 'openExternal', 'geolocation', ''].map(
        isPermissionAllowed,
      ),
    ).toEqual([false, false, false, false, false, false])
  })
})

describe('isTrustedSender', () => {
  it('trusts only a frame on the page origin', () => {
    expect(isTrustedSender('http://localhost:47484/')).toBe(true)
    expect(isTrustedSender('http://localhost:47484/downloads')).toBe(true)
    expect(isTrustedSender('https://example.com/')).toBe(false)
    expect(isTrustedSender('app://raven/index.html')).toBe(false)
    expect(isTrustedSender('http://localhost:47485/')).toBe(false)
    expect(isTrustedSender(null)).toBe(false)
    expect(isTrustedSender(undefined)).toBe(false)
    expect(isTrustedSender('')).toBe(false)
  })
})
