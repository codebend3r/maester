import { describe, expect, test } from 'bun:test'
import {
  FETCH_STRATEGIES,
  type RequestFacts,
  isShellAnswer,
  overflowOf,
  strategyFor,
} from '@/serviceWorker/fetchStrategy'

const ORIGIN = 'https://raven.example'

type GetProps = Partial<RequestFacts> & { path?: string }

const get = ({ path = '', ...facts }: GetProps): RequestFacts => ({
  method: 'GET',
  url: `${ORIGIN}${path}`,
  mode: 'cors',
  hasRange: false,
  ...facts,
})

describe('strategyFor', () => {
  test('a navigation goes to the network first, with the shell behind it', () => {
    expect(
      strategyFor({ request: get({ path: '/libraries/3', mode: 'navigate' }), origin: ORIGIN }),
    ).toBe(FETCH_STRATEGIES.shell)
  })

  test('a hashed build file comes from the cache', () => {
    expect(strategyFor({ request: get({ path: '/assets/index-abc123.js' }), origin: ORIGIN })).toBe(
      FETCH_STRATEGIES.asset,
    )
  })

  test('an icon, the manifest and a font are kept and refreshed', () => {
    const paths = ['/icons/icon-192.png', '/manifest.webmanifest', '/favicon.svg', '/favicon.ico']
    expect(paths.map((path) => strategyFor({ request: get({ path }), origin: ORIGIN }))).toEqual(
      paths.map(() => FETCH_STRATEGIES.file),
    )
  })

  test('the API is never kept, even when navigated to', () => {
    expect(strategyFor({ request: get({ path: '/api/me' }), origin: ORIGIN })).toBe(
      FETCH_STRATEGIES.network,
    )
    expect(
      strategyFor({
        request: get({ path: '/api/media/1/file', mode: 'navigate' }),
        origin: ORIGIN,
      }),
    ).toBe(FETCH_STRATEGIES.network)
  })

  test("Netlify's own paths are left to the network", () => {
    expect(
      strategyFor({ request: get({ path: '/.netlify/images?url=x.png' }), origin: ORIGIN }),
    ).toBe(FETCH_STRATEGIES.network)
  })

  test('a ranged request, a write and another origin are left to the network', () => {
    expect(
      strategyFor({ request: get({ path: '/assets/a.js', hasRange: true }), origin: ORIGIN }),
    ).toBe(FETCH_STRATEGIES.network)
    expect(
      strategyFor({ request: get({ path: '/assets/a.js', method: 'POST' }), origin: ORIGIN }),
    ).toBe(FETCH_STRATEGIES.network)
    expect(
      strategyFor({
        request: get({ url: 'https://media.example/assets/a.js' }),
        origin: ORIGIN,
      }),
    ).toBe(FETCH_STRATEGIES.network)
  })

  test('the worker itself and anything unknown are left to the network', () => {
    expect(strategyFor({ request: get({ path: '/sw.js' }), origin: ORIGIN })).toBe(
      FETCH_STRATEGIES.network,
    )
    expect(strategyFor({ request: get({ path: '/remote-access/check' }), origin: ORIGIN })).toBe(
      FETCH_STRATEGIES.network,
    )
  })
})

describe('overflowOf', () => {
  test('names the oldest past the limit', () => {
    expect(overflowOf({ keys: ['a', 'b', 'c', 'd'], limit: 2 })).toEqual(['a', 'b'])
  })

  test('names nothing within the limit', () => {
    expect(overflowOf({ keys: ['a'], limit: 2 })).toEqual([])
  })
})

describe('isShellAnswer', () => {
  test("keeps the app's own page", () => {
    expect(
      isShellAnswer({ status: 200, isRedirected: false, contentType: 'text/html; charset=utf-8' }),
    ).toBe(true)
  })

  test('skips an error, a redirect and anything that is not a page', () => {
    expect(isShellAnswer({ status: 404, isRedirected: false, contentType: 'text/html' })).toBe(
      false,
    )
    expect(isShellAnswer({ status: 200, isRedirected: true, contentType: 'text/html' })).toBe(false)
    expect(
      isShellAnswer({ status: 200, isRedirected: false, contentType: 'application/json' }),
    ).toBe(false)
    expect(isShellAnswer({ status: 200, isRedirected: false, contentType: null })).toBe(false)
  })
})
