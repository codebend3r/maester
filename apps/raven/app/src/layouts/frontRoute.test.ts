import { describe, expect, it } from 'bun:test'

import { frontRouteKeyOf } from '@/layouts/frontRoute'

describe('frontRouteKeyOf', () => {
  it('names the focused route', () => {
    const state = { index: 1, routes: [{ key: 'home' }, { key: 'album-7' }] }
    expect(frontRouteKeyOf({ state })).toBe('album-7')
  })

  it('takes the last route when the state names no index', () => {
    const state = { routes: [{ key: 'home' }, { key: 'artist-3' }] }
    expect(frontRouteKeyOf({ state })).toBe('artist-3')
  })

  it('goes down into a navigator nested in the focused route', () => {
    const nested = { index: 1, routes: [{ key: 'home' }, { key: 'item' }] }
    const state = { index: 0, routes: [{ key: 'root', state: nested }] }
    expect(frontRouteKeyOf({ state })).toBe('item')
  })

  it('is null before any route is known', () => {
    expect(frontRouteKeyOf({ state: undefined })).toBeNull()
    expect(frontRouteKeyOf({ state: { routes: [] } })).toBeNull()
  })
})
