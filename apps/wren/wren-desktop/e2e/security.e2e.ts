import { request } from 'node:http'
import { expect, test } from '@playwright/test'
import { WREN_HOST, WREN_HOST_PORT, WREN_PAGE_ORIGIN } from '@raven/wren'
import { LOOPBACK_ADDRESSES } from '@shared/desktop'
import { HEADERS, HTTP_STATUSES } from '@shared/http'
import { SOCKET_EVENTS, appForSuite, browserOpens, homeTile, stubBrowser } from '@/e2e/harness'
import { EVENTS } from '@/main/events'

/*
 * Written out rather than imported, so the test checks the header against what the app promises,
 * not against the module that sends it. `script-src` and `style-src` name the page's inline
 * script and style by their hashes, which change with every web build, so they are read apart.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src; style-src; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
const SCRIPT_SOURCES = /script-src [^;]+/u
const STYLE_SOURCES = /style-src [^;]+/u
const HASHED_SOURCES = /^(script|style)-src 'self'( 'sha256-[A-Za-z0-9+/=]+')*$/u
const INLINE_SCRIPT_HASH = /'sha256-[A-Za-z0-9+/=]+'/u

// The address the web host is asked at, which is not the name it answers to.
const [LOOPBACK] = LOOPBACK_ADDRESSES

const NAVIGATION_KEY = 'wrenE2eNavigation'
const ELSEWHERE = 'https://example.com/'
const KEPT = 'kept'

type StatusForProps = { host: string }

/** What the web host answers a request sent with `host` as its `Host`, from outside the app. */
const statusFor = ({ host }: StatusForProps) =>
  new Promise<number>((resolve, reject) => {
    const outgoing = request(
      { host: LOOPBACK, port: WREN_HOST_PORT, path: '/', headers: { host } },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    outgoing.on(SOCKET_EVENTS.error, reject)
    outgoing.end()
  })

test.describe('the security the main process promises', () => {
  const running = appForSuite()

  test.beforeAll(async () => {
    await expect(homeTile({ page: running().page })).toBeVisible()
  })

  test('leaves require and process undefined in the page', async () => {
    const kinds = await running().page.evaluate(() => [typeof require, typeof process])
    expect(kinds).toEqual(['undefined', 'undefined'])
  })

  test('refuses a request for any Host but its own, which blocks DNS rebinding', async () => {
    expect(await statusFor({ host: WREN_HOST })).toBe(HTTP_STATUSES.ok)
    expect(await statusFor({ host: `evil.example:${WREN_HOST_PORT}` })).toBe(
      HTTP_STATUSES.misdirected,
    )
    expect(await statusFor({ host: `${LOOPBACK}:${WREN_HOST_PORT}` })).toBe(
      HTTP_STATUSES.misdirected,
    )
  })

  test('sends the content security policy, and no sniffing', async () => {
    const answer = await running().page.evaluate(
      async ({ policy, sniffing }) => {
        const response = await fetch('/index.html')
        return {
          status: response.status,
          policy: response.headers.get(policy) ?? '',
          sniffing: response.headers.get(sniffing) ?? '',
        }
      },
      { policy: HEADERS.contentSecurityPolicy, sniffing: HEADERS.contentTypeOptions },
    )
    expect(answer.status).toBe(HTTP_STATUSES.ok)
    expect(answer.sniffing).toBe('nosniff')
    expect(
      answer.policy.replace(SCRIPT_SOURCES, 'script-src').replace(STYLE_SOURCES, 'style-src'),
    ).toBe(CONTENT_SECURITY_POLICY)
    const scripts = SCRIPT_SOURCES.exec(answer.policy)?.[0] ?? ''
    expect(scripts).toMatch(HASHED_SOURCES)
    // The theme script in `index.html` runs only because its hash is named.
    expect(scripts).toMatch(INLINE_SCRIPT_HASH)
    expect(STYLE_SOURCES.exec(answer.policy)?.[0] ?? '').toMatch(HASHED_SOURCES)
  })

  test('grants the page no camera, microphone or notifications', async () => {
    const states = await running().page.evaluate(async () => {
      const asked = await Promise.all([
        navigator.permissions.query({ name: 'camera' }),
        navigator.permissions.query({ name: 'microphone' }),
        navigator.permissions.query({ name: 'notifications' }),
      ])
      return asked.map(({ state }) => state)
    })
    expect(states).toEqual(['denied', 'denied', 'denied'])
  })

  test('opens no window of its own, and a web link in the browser', async () => {
    const { app, page } = running()
    await stubBrowser({ app })
    expect(await page.evaluate(() => window.open('about:blank') === null)).toBe(true)
    expect(await page.evaluate((url) => window.open(url) === null, ELSEWHERE)).toBe(true)
    await expect.poll(() => browserOpens({ app })).toEqual([ELSEWHERE])
    expect(app.windows()).toHaveLength(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })

  /*
   * Last: Playwright never hears that a navigation the app cancelled has ended, so locators on
   * the page would wait for it from then on. Only evaluations follow it.
   */
  test('opens another origin in the browser and keeps the page', async () => {
    const { app, page } = running()
    await stubBrowser({ app })
    /*
     * The app's own will-navigate listener was added when the window was made, so this one
     * runs after it and sees whether it prevented the navigation.
     */
    await app.evaluate(
      ({ BrowserWindow }, { key, willNavigate }) => {
        const [window] = BrowserWindow.getAllWindows()
        if (window === undefined) throw new Error('Wren has no window.')
        const decided = new Promise((resolve) => {
          window.webContents.once(willNavigate, (event) => {
            resolve({ url: event.url, isPrevented: event.defaultPrevented })
          })
        })
        Reflect.set(globalThis, key, decided)
      },
      { key: NAVIGATION_KEY, willNavigate: EVENTS.willNavigate },
    )
    await page.evaluate(
      ({ url, marker }) => {
        document.body.dataset.e2eMarker = marker
        location.href = url
      },
      { url: ELSEWHERE, marker: KEPT },
    )

    const decision = await app.evaluate((_electron, key) => {
      const decided: unknown = Reflect.get(globalThis, key)
      return decided
    }, NAVIGATION_KEY)
    expect(decision).toEqual({ url: ELSEWHERE, isPrevented: true })
    await expect.poll(() => browserOpens({ app })).toEqual([ELSEWHERE])
    expect(page.url()).toBe(`${WREN_PAGE_ORIGIN}/`)
    expect(await page.evaluate(() => document.body.dataset.e2eMarker)).toBe(KEPT)
  })
})
