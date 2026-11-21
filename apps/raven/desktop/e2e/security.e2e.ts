import { request } from 'node:http'
import { expect, test } from '@playwright/test'
import {
  DESKTOP_PATHS,
  DESKTOP_REPLIES,
  PAGE_ORIGIN,
  RAVEN_DESKTOP_BRIDGE_KEY,
  WEB_HOST_PORT,
} from '@raven/core'
import {
  browserOpens,
  closeApp,
  expectOffline,
  freshUserData,
  type Launched,
  launchApp,
  removeDir,
  requestFromPage,
  stubBrowser,
} from '@/e2e/harness'

/*
 * Written out rather than imported, so the test checks the header against the spec, not
 * against the module that sends it. `script-src` and `style-src` name the page's inline script
 * and style by their hashes, which change with every web build, so they are read apart.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src; style-src; font-src 'self'; img-src 'self' data: raven-picture:; media-src 'self' raven-file:; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
const SCRIPT_SOURCES = /script-src [^;]+/u
const INLINE_HASH = /^script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+$/u
const STYLE_SOURCES = /style-src [^;]+/u
const INLINE_STYLE_HASH = /^style-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+$/u

// All the preload hands the page: no `dropFiles`, and nothing else that could carry a path.
const BRIDGE_KEYS = ['platform', 'request', 'subscribe']
// The requests that opened a file from this computer, which main no longer knows.
const REMOVED_REQUESTS = [
  'openDialog',
  'listRecents',
  'openRecent',
  'removeRecent',
  'clearRecents',
] as const
// A request main never knew, which a removed one must be refused exactly as.
const UNKNOWN_REQUEST = { type: 'readFile', path: '/etc/hosts' } as const

const NAVIGATION_KEY = 'ravenE2eNavigation'
const ELSEWHERE = 'https://example.com/'

type StatusForProps = { host: string }

/** What the web host answers a request sent with `host` as its `Host`, from outside the app. */
const statusFor = ({ host }: StatusForProps) =>
  new Promise<number>((resolve, reject) => {
    const outgoing = request(
      { host: '127.0.0.1', port: WEB_HOST_PORT, path: '/', headers: { host } },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })

test.describe('the security baseline', () => {
  let userData = ''
  let launched: Launched | null = null

  const running = (): Launched => {
    if (launched === null) throw new Error('Raven is not running.')
    return launched
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    launched = await launchApp({ userData })
    await expectOffline({ page: running().page })
  })

  test.afterAll(async () => {
    const quit = launched === null ? Promise.resolve() : closeApp({ app: launched.app })
    await quit.finally(() => removeDir(userData))
  })

  test('leaves require and process undefined in the page', async () => {
    const kinds = await running().page.evaluate(() => [typeof require, typeof process])
    expect(kinds).toEqual(['undefined', 'undefined'])
  })

  test('refuses a request for any Host but its own, which blocks DNS rebinding', async () => {
    expect(await statusFor({ host: `localhost:${WEB_HOST_PORT}` })).toBe(200)
    expect(await statusFor({ host: `evil.example:${WEB_HOST_PORT}` })).toBe(421)
    expect(await statusFor({ host: `127.0.0.1:${WEB_HOST_PORT}` })).toBe(421)
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

  test("hands the bridge only to the web host's own origin", async () => {
    const { app, page } = running()
    expect(await page.evaluate(() => typeof Reflect.get(window, 'ravenDesktop'))).toBe('object')

    // A hidden window with the app's own preload: what its page sees as `window.ravenDesktop`.
    const bridgeIn = async (url: string) => {
      const opened = app.waitForEvent('window')
      await app.evaluate(({ app: electronApp, BrowserWindow }, address) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: `${electronApp.getAppPath()}/dist/preload/preload.cjs`,
            contextIsolation: true,
            sandbox: true,
          },
        })
        return window.loadURL(address)
      }, url)
      const other = await opened
      try {
        return {
          origin: new URL(other.url()).origin,
          bridge: await other.evaluate(() => typeof Reflect.get(window, 'ravenDesktop')),
        }
      } finally {
        await other.close()
      }
    }

    /*
     * On the page's origin it has the bridge, so the preload runs in such a window; a missing
     * asset keeps the web app from starting there. Under another name for the web host's port,
     * which it refuses, it has none.
     */
    expect(await bridgeIn(`${PAGE_ORIGIN}/assets/missing.js`)).toEqual({
      origin: PAGE_ORIGIN,
      bridge: 'object',
    })
    const other = await bridgeIn(`http://127.0.0.1:${WEB_HOST_PORT}/`)
    expect(other.origin).not.toBe(PAGE_ORIGIN)
    expect(other.bridge).toBe('undefined')
  })

  test('refuses a request off the bridge list', async () => {
    const reply = await requestFromPage({ page: running().page, request: UNKNOWN_REQUEST })
    expect(reply?.type ?? null).toBe(DESKTOP_REPLIES.refused)
  })

  test('hands the page no way to drop a file, and refuses the requests that opened one', async () => {
    const { page } = running()
    const keys = await page.evaluate((bridgeKey) => {
      const bridge: unknown = Reflect.get(window, bridgeKey)
      return typeof bridge === 'object' && bridge !== null ? Object.keys(bridge).toSorted() : null
    }, RAVEN_DESKTOP_BRIDGE_KEY)
    expect(keys).toEqual(BRIDGE_KEYS)

    const unknown = await requestFromPage({ page, request: UNKNOWN_REQUEST })
    expect(unknown?.type ?? null).toBe(DESKTOP_REPLIES.refused)
    const replies = await Promise.all(
      REMOVED_REQUESTS.map((type) => requestFromPage({ page, request: { type } })),
    )
    expect(replies).toEqual(REMOVED_REQUESTS.map(() => unknown))
    expect(page.url()).toBe(`${PAGE_ORIGIN}${DESKTOP_PATHS.downloads}`)
  })

  test('sends the content security policy', async () => {
    const answer = await running().page.evaluate(async () => {
      const response = await fetch('/index.html')
      return {
        status: response.status,
        policy: response.headers.get('content-security-policy') ?? '',
      }
    })
    expect(answer.status).toBe(200)
    expect(
      answer.policy.replace(SCRIPT_SOURCES, 'script-src').replace(STYLE_SOURCES, 'style-src'),
    ).toBe(CONTENT_SECURITY_POLICY)
    expect(SCRIPT_SOURCES.exec(answer.policy)?.[0] ?? '').toMatch(INLINE_HASH)
    expect(STYLE_SOURCES.exec(answer.policy)?.[0] ?? '').toMatch(INLINE_STYLE_HASH)
  })

  test("refuses an encoded way out of the web app's folder", async () => {
    /*
     * The folder is the web app's `dist`. `%2e%2e` is normalized away by URL parsing before
     * the handler sees it, leaving `/package.json`, which the folder does not hold, so the
     * single-page app answers with its page. The other two decode to paths outside the folder,
     * the first to the web project's own package.json, so only the containment check stands
     * between them and that file.
     */
    const paths = ['/%2e%2e/package.json', '/..%2fpackage.json', '/..%2f..%2f..%2fpackage.json']
    const answers = await running().page.evaluate(
      (sent) =>
        Promise.all(
          sent.map(async (path) => {
            const response = await fetch(path)
            return { status: response.status, body: await response.text() }
          }),
        ),
      paths,
    )
    expect(answers.map(({ status }) => status)).toEqual([200, 403, 403])
    expect(answers[0]?.body ?? '').toMatch(/^<!doctype html>/u)
  })

  test('fails a video whose file id was never granted', async () => {
    const { app, page } = running()
    const unknown = 'raven-file://00000000-0000-4000-8000-000000000000'
    const outcome = await page.evaluate(
      (src) =>
        new Promise<string>((resolve) => {
          const video = document.createElement('video')
          video.addEventListener('error', () => resolve('error'), { once: true })
          video.addEventListener('loadedmetadata', () => resolve('loaded'), { once: true })
          video.src = src
        }),
      unknown,
    )
    expect(outcome).toBe('error')

    /*
     * The page may not fetch `raven-file:` itself (the CSP's connect-src), so main asks its
     * own handler: a 404 is the grant check answering, where a broken scheme would throw.
     */
    const status = await app.evaluate(
      async ({ net }, url) => (await net.fetch(url)).status,
      unknown,
    )
    expect(status).toBe(404)
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
    await app.evaluate(({ BrowserWindow }, key) => {
      const [window] = BrowserWindow.getAllWindows()
      if (window === undefined) throw new Error('Raven has no window.')
      const decided = new Promise((resolve) => {
        window.webContents.once('will-navigate', (event) => {
          resolve({ url: event.url, isPrevented: event.defaultPrevented })
        })
      })
      Reflect.set(globalThis, key, decided)
    }, NAVIGATION_KEY)
    await page.evaluate((url) => {
      document.body.dataset.e2eMarker = 'kept'
      location.href = url
    }, ELSEWHERE)

    const decision = await app.evaluate((_electron, key) => {
      const decided: unknown = Reflect.get(globalThis, key)
      return decided
    }, NAVIGATION_KEY)
    expect(decision).toEqual({ url: ELSEWHERE, isPrevented: true })
    await expect.poll(() => browserOpens({ app })).toEqual([ELSEWHERE])
    expect(page.url()).toBe(`${PAGE_ORIGIN}${DESKTOP_PATHS.downloads}`)
    expect(await page.evaluate(() => document.body.dataset.e2eMarker)).toBe('kept')
  })
})
