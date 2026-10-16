import { expect, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import {
  closeApp,
  freshUserData,
  type Launched,
  launchApp,
  removeDir,
  requestFromPage,
  withApp,
} from '@/e2e/harness'
import { isDesktopReply } from '@/shared/protocol'

// Written out rather than imported, so the test checks the header against the spec, not
// against the module that sends it.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

const NAVIGATION_KEY = 'ravenE2eNavigation'

test.describe('the security baseline', () => {
  let userData = ''
  let clips: Clips = { folder: '', first: '', second: '' }
  let launched: Launched | null = null

  const running = (): Launched => {
    if (launched === null) throw new Error('raven player is not running.')
    return launched
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    clips = await makeClips()
    launched = await launchApp({ userData })
    await expect(running().page.getByRole('heading', { name: 'raven player' })).toBeVisible()
  })

  test.afterAll(async () => {
    const quit = launched === null ? Promise.resolve() : closeApp({ app: launched.app })
    await quit.finally(() => Promise.all([removeDir(userData), removeDir(clips.folder)]))
  })

  test('leaves require and process undefined in the page', async () => {
    const kinds = await running().page.evaluate(() => [typeof require, typeof process])
    expect(kinds).toEqual(['undefined', 'undefined'])
  })

  // Its own app: Playwright never hears that a navigation the app cancelled has ended, so
  // locators on that page wait for it from then on.
  test('refuses to navigate to another origin', async () => {
    const ownUserData = await freshUserData()
    await withApp({
      userData: ownUserData,
      run: async ({ app, page }) => {
        await expect(page.getByRole('heading', { name: 'raven player' })).toBeVisible()
        // The app's own will-navigate listener was added when the window was made, so this
        // one runs after it and sees whether it prevented the navigation.
        await app.evaluate(({ BrowserWindow }, key) => {
          const [window] = BrowserWindow.getAllWindows()
          if (window === undefined) throw new Error('raven player has no window.')
          const decided = new Promise((resolve) => {
            window.webContents.once('will-navigate', (event) => {
              resolve({ url: event.url, isPrevented: event.defaultPrevented })
            })
          })
          Reflect.set(globalThis, key, decided)
        }, NAVIGATION_KEY)
        await page.evaluate(() => {
          document.body.dataset.e2eMarker = 'kept'
          location.href = 'https://example.com/'
        })

        const decision = await app.evaluate((_electron, key) => {
          const decided: unknown = Reflect.get(globalThis, key)
          return decided
        }, NAVIGATION_KEY)
        expect(decision).toEqual({ url: 'https://example.com/', isPrevented: true })
        expect(page.url()).toMatch(/^app:\/\/raven\//)
        expect(await page.evaluate(() => document.body.dataset.e2eMarker)).toBe('kept')
      },
    }).finally(() => removeDir(ownUserData))
  })

  test('denies window.open', async () => {
    const { app, page } = running()
    expect(await page.evaluate(() => window.open('about:blank') === null)).toBe(true)
    expect(app.windows()).toHaveLength(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })

  test('refuses a request off the bridge list', async () => {
    const reply = await requestFromPage({
      page: running().page,
      request: { type: 'readFile', path: '/etc/hosts' },
    })
    expect(reply?.type ?? null).toBe('refused')
  })

  test('opens nothing from a forged drop', async () => {
    const { page } = running()
    // Each names a real video, so a path that got through would play it.
    const replies = await page.evaluate(async (path) => {
      if (!('ravenDesktop' in window)) return null
      const bridge = window.ravenDesktop
      if (typeof bridge !== 'object' || bridge === null || !('dropFiles' in bridge)) return null
      const drop = bridge.dropFiles
      if (typeof drop !== 'function') return null
      const forgeries: unknown[] = [
        [path],
        [{ name: 'Clip 01.mp4', path, type: 'video/mp4' }],
        { length: 1, 0: new File(['x'], path, { type: 'video/mp4' }) },
        { filter: () => [path], map: () => [path], reduce: () => [path] },
        [new File(['x'], path, { type: 'video/mp4' })],
      ]
      return Promise.all(forgeries.map(async (files): Promise<unknown> => drop(files)))
    }, clips.first)

    expect(replies).toHaveLength(5)
    const refusals = (replies ?? []).map((reply) => (isDesktopReply(reply) ? reply : null))
    expect(refusals).toEqual(
      Array.from({ length: 5 }, () => ({
        type: 'refused',
        message: 'Drop a video file to play it.',
      })),
    )
    await expect(page.getByRole('heading', { name: 'raven player' })).toBeVisible()
  })

  test('sends the content security policy', async () => {
    const answer = await running().page.evaluate(async () => {
      const response = await fetch('/index.html')
      return {
        status: response.status,
        policy: response.headers.get('content-security-policy'),
      }
    })
    expect(answer).toEqual({ status: 200, policy: CONTENT_SECURITY_POLICY })
  })

  test('refuses an encoded way out of the page folder', async () => {
    // The page folder is `dist/renderer`. The last two land on files that exist (the
    // project's package.json and `dist/main/main.js`), so only the containment check
    // stands between them and a 200. `%2e%2e` is normalized away by URL parsing before
    // the handler sees it, leaving `/package.json`, which the page folder does not hold.
    const paths = ['/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/..%2fmain%2fmain.js']
    const statuses = await running().page.evaluate(
      (sent) => Promise.all(sent.map(async (path) => (await fetch(path)).status)),
      paths,
    )
    expect(statuses).toEqual([404, 403, 403])
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

    // The page may not fetch `raven-file:` itself (the CSP's connect-src), so main asks its
    // own handler: a 404 is the grant check answering, where a broken scheme would throw.
    const status = await app.evaluate(
      async ({ net }, url) => (await net.fetch(url)).status,
      unknown,
    )
    expect(status).toBe(404)
  })
})
