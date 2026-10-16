import { describe, expect, it } from 'bun:test'
import {
  isAppUrl,
  isExternalLink,
  isPermissionAllowed,
  isTrustedSender,
  windowOpenFor,
} from '@/main/security'

describe('isAppUrl', () => {
  it('accepts only app://raven', () => {
    expect(isAppUrl('app://raven/index.html')).toBe(true)
    expect(isAppUrl('app://raven/')).toBe(true)
    expect(isAppUrl('app://raven')).toBe(true)
    expect(isAppUrl('app://raven/#/play')).toBe(true)
  })

  it.each([
    'app://raven.evil/',
    'app://other/',
    'app://raven:8080/',
    'app://evil@raven/',
    'app://user:pass@raven/',
    'https://raven/',
    'http://raven/',
    'raven-file://raven/',
    'file:///etc/hosts',
    'about:blank',
    'not a url',
    '',
  ])('refuses %p', (url) => {
    expect(isAppUrl(url)).toBe(false)
  })
})

describe('isExternalLink', () => {
  it('is true for http and https only', () => {
    expect(isExternalLink('https://example.com/a')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
    expect(isExternalLink('file:///x')).toBe(false)
    expect(isExternalLink('javascript:alert(1)')).toBe(false)
    expect(isExternalLink('app://raven/')).toBe(false)
    expect(isExternalLink('raven://play')).toBe(false)
    expect(isExternalLink('')).toBe(false)
  })
})

describe('windowOpenFor', () => {
  it('always denies and opens only http and https externally', () => {
    expect(windowOpenFor('https://example.com')).toEqual({
      action: 'deny',
      shouldOpenExternally: true,
    })
    expect(windowOpenFor('http://example.com')).toEqual({
      action: 'deny',
      shouldOpenExternally: true,
    })
    expect(windowOpenFor('about:blank')).toEqual({ action: 'deny', shouldOpenExternally: false })
    expect(windowOpenFor('file:///x')).toEqual({ action: 'deny', shouldOpenExternally: false })
    expect(windowOpenFor('app://raven/')).toEqual({ action: 'deny', shouldOpenExternally: false })
    expect(windowOpenFor('')).toEqual({ action: 'deny', shouldOpenExternally: false })
  })
})

describe('isPermissionAllowed', () => {
  it('allows fullscreen and nothing else', () => {
    expect(isPermissionAllowed('fullscreen')).toBe(true)
    expect(
      ['media', 'notifications', 'clipboard-read', 'openExternal', 'geolocation', ''].map(
        isPermissionAllowed,
      ),
    ).toEqual([false, false, false, false, false, false])
  })
})

describe('isTrustedSender', () => {
  it('trusts only a frame on app://raven', () => {
    expect(isTrustedSender('app://raven/index.html')).toBe(true)
    expect(isTrustedSender('https://example.com/')).toBe(false)
    expect(isTrustedSender('app://raven.evil/')).toBe(false)
    expect(isTrustedSender(null)).toBe(false)
    expect(isTrustedSender(undefined)).toBe(false)
    expect(isTrustedSender('')).toBe(false)
  })
})
