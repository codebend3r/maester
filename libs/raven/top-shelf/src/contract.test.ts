import { describe, expect, test } from 'bun:test'

import {
  TOP_SHELF_KINDS,
  TOP_SHELF_LAYOUTS,
  type TopShelf,
  deepLinkOf,
  topShelfKeyOf,
} from '@/contract'

describe('deepLinkOf', () => {
  test('fills each bracketed segment from its param', () => {
    expect(
      deepLinkOf({ scheme: 'raven', pathname: '/play/[mediaId]', params: { mediaId: '42' } }),
    ).toBe('raven://play/42')
  })

  test('puts the params no segment names in the query', () => {
    expect(
      deepLinkOf({
        scheme: 'raven',
        pathname: '/item/[id]',
        params: { id: '7', library: '3', file: '11' },
      }),
    ).toBe('raven://item/7?library=3&file=11')
  })

  test('opens a route with no params on its path alone', () => {
    expect(deepLinkOf({ scheme: 'wren-tv', pathname: '/sign-in', params: {} })).toBe(
      'wren-tv://sign-in',
    )
  })

  test('escapes what a segment holds', () => {
    expect(deepLinkOf({ scheme: 'raven', pathname: '/saga/[id]', params: { id: 'a b' } })).toBe(
      'raven://saga/a%20b',
    )
  })
})

const shelfWith = (token: string): TopShelf => ({
  kind: TOP_SHELF_KINDS.titles,
  layout: TOP_SHELF_LAYOUTS.carousel,
  title: 'Continue watching',
  items: [
    {
      id: '1',
      title: 'Dune',
      summary: null,
      picture: { uri: 'https://raven/backdrop/1', headers: { authorization: token } },
      playUrl: 'raven://play/1',
      openUrl: 'raven://item/1',
    },
  ],
})

describe('topShelfKeyOf', () => {
  test('is the same once the token is renewed', () => {
    expect(topShelfKeyOf(shelfWith('Bearer a'))).toBe(topShelfKeyOf(shelfWith('Bearer b')))
  })

  test('changes with the titles', () => {
    const signedOut: TopShelf = {
      kind: TOP_SHELF_KINDS.signedOut,
      title: 'Sign in to Raven',
      openUrl: 'raven://sign-in',
    }
    expect(topShelfKeyOf(signedOut)).not.toBe(topShelfKeyOf(shelfWith('Bearer a')))
  })
})
