import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { playLinkFor } from '@raven/core'
import { expect, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import { routesOf, startFixtureServer } from '@/e2e/fixtureServer'
import { API_PATHS } from '@/main/servers/allowlist'
import {
  browserOpens,
  closeApp,
  freshUserData,
  type Launched,
  launchApp,
  openUrl,
  removeDir,
  requestFromPage,
  serverPartitions,
  stubBrowser,
  stubTrustPrompt,
  trustPrompts,
  withApp,
} from '@/e2e/harness'
import { DESKTOP_REPLIES, isDesktopReply } from '@/shared/protocol'

// Written out rather than imported, so the test checks the header against the spec, not
// against the module that sends it.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

const NAVIGATION_KEY = 'ravenE2eNavigation'

/**
 * A listener on 127.0.0.1 that logs `METHOD path` and the `Cookie` header (or '') for every
 * request, and answers with `answer`.
 */
const startListener = async ({
  answer,
}: {
  answer: (input: { request: IncomingMessage; response: ServerResponse }) => void
}) => {
  const requests: string[] = []
  const cookies: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`)
    cookies.push(request.headers.cookie ?? '')
    answer({ request, response })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No listener port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    host: `127.0.0.1:${address.port}`,
    requests,
    cookies,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

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

  // Electron 44's `ses.fetch` with `redirect: 'error'` on a `persist:server:` session: a
  // redirect to another listener fails the call there, so no cookie of the server's can
  // follow it. The trust probe is the first call a new server's session makes.
  test('never follows a server redirect, and clears the session it left at the next launch', async () => {
    const ownUserData = await freshUserData()
    const elsewhere = await startListener({
      answer: ({ response }) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"available":true,"unlocked":false}')
      },
    })
    const redirecting = await startListener({
      answer: ({ response }) => {
        response.writeHead(302, { location: `${elsewhere.origin}/api/lock` })
        response.end()
      },
    })
    try {
      await withApp({
        userData: ownUserData,
        run: async ({ app, page }) => {
          await expect(page.getByRole('heading', { name: 'raven player' })).toBeVisible()
          await stubTrustPrompt({ app, answer: 'add' })
          await openUrl({
            app,
            url: playLinkFor({ origin: redirecting.origin, mediaId: 1, at: 0, next: [] }),
          })
          await expect(
            page.getByText(`No raven server answered at ${redirecting.origin}.`),
          ).toBeVisible()
          expect(await trustPrompts({ app })).toEqual([
            `Add the raven server at ${redirecting.origin}?`,
          ])
          expect(redirecting.requests).toEqual(['GET /api/lock'])
          expect(elsewhere.requests).toEqual([])
          expect(await requestFromPage({ page, request: { type: 'listServers' } })).toEqual({
            type: 'servers',
            servers: [],
          })
        },
      })
      // The probe's session was cleared but its folder stays until the next launch.
      expect(await serverPartitions({ userData: ownUserData })).toHaveLength(1)
      await withApp({
        userData: ownUserData,
        run: async ({ page }) => {
          await expect(page.getByRole('heading', { name: 'raven player' })).toBeVisible()
        },
      })
      expect(await serverPartitions({ userData: ownUserData })).toEqual([])
    } finally {
      await Promise.all([redirecting.close(), elsewhere.close(), removeDir(ownUserData)])
    }
  })

  // The same, with a cookie in the jar: a server that was trusted, and set its cookie on that
  // answer, then redirects a title read. The cookie reaches it and goes nowhere else.
  test('never carries a server cookie through a redirect', async () => {
    const ownUserData = await freshUserData()
    const elsewhere = await startListener({
      answer: ({ response }) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
      },
    })
    const redirecting = await startListener({
      answer: ({ request, response }) => {
        if (request.url === API_PATHS.lock) {
          response.writeHead(200, {
            'content-type': 'application/json',
            'set-cookie': 'raven_unlock=a.b; Path=/api; HttpOnly; SameSite=Strict',
          })
          response.end('{"available":true,"unlocked":true}')
          return
        }
        response.writeHead(302, { location: `${elsewhere.origin}${request.url ?? '/'}` })
        response.end()
      },
    })
    try {
      await withApp({
        userData: ownUserData,
        run: async ({ app, page }) => {
          await expect(page.getByRole('heading', { name: 'raven player' })).toBeVisible()
          await stubTrustPrompt({ app, answer: 'add' })
          await stubBrowser({ app })
          await openUrl({
            app,
            url: playLinkFor({ origin: redirecting.origin, mediaId: 1, at: 0, next: [] }),
          })
          await expect(
            page.getByText(`raven player could not reach ${redirecting.host}.`),
          ).toBeVisible()
          expect(redirecting.requests).toEqual(['GET /api/lock', 'GET /api/media/1'])
          expect(redirecting.cookies).toEqual(['', 'raven_unlock=a.b'])
          expect(elsewhere.requests).toEqual([])
          expect(elsewhere.cookies).toEqual([])
          expect(await browserOpens({ app })).toEqual([])
        },
      })
    } finally {
      await Promise.all([redirecting.close(), elsewhere.close(), removeDir(ownUserData)])
    }
  })

  test('refuses a server call off the allowlist', async () => {
    const { app, page } = running()
    const fixture = await startFixtureServer({
      clips: { first: clips.first, second: clips.second, tracks: clips.first },
      mode: { pin: '3001', isLocked: false, admin: { kind: 'off' } },
    })
    try {
      await stubTrustPrompt({ app, answer: 'add' })
      const added = await requestFromPage({
        page,
        request: { type: 'addServer', origin: fixture.origin },
      })
      const [serverId = ''] =
        added !== null && added.type === DESKTOP_REPLIES.servers
          ? added.servers.map((s) => s.serverId)
          : []
      expect(serverId).not.toBe('')
      const listed = await requestFromPage({ page, request: { type: 'listServers' } })
      expect(
        listed !== null && listed.type === DESKTOP_REPLIES.servers
          ? listed.servers.map((s) => s.serverId)
          : [],
      ).toEqual([serverId])
      const probed = fixture.requests.length

      // Real server routes the page has no business calling, and allowed ones bent out of shape.
      const forgeries = [
        { method: 'GET', path: '/api/media/1/location', body: null },
        { method: 'GET', path: '/api/admin/settings', body: null },
        { method: 'PUT', path: '/api/admin/settings', body: '{"pin":"0000"}' },
        { method: 'GET', path: '/api/media/1/file', body: null },
        { method: 'GET', path: '/api/media/1?x=1', body: null },
        { method: 'GET', path: '/api/media/1/../../admin/settings', body: null },
        { method: 'GET', path: `${fixture.elsewhere.origin}/api/media/1`, body: null },
        { method: 'POST', path: '/api/media/1/plays', body: '{"extra":true}' },
      ]
      const replies = await Promise.all(
        forgeries.map((forgery) =>
          requestFromPage({ page, request: { type: 'serverCall', serverId, ...forgery } }),
        ),
      )
      expect(replies).toEqual(
        forgeries.map(() => ({
          type: 'serverUnreachable',
          message: 'raven player does not make that call.',
        })),
      )

      const unknown = await requestFromPage({
        page,
        request: {
          type: 'serverCall',
          serverId: '00000000-0000-4000-8000-000000000000',
          method: 'GET',
          path: '/api/media/1',
          body: null,
        },
      })
      expect(unknown).toEqual({
        type: 'serverUnreachable',
        message: 'That server is no longer in raven player.',
      })

      // A call on the list still goes through, so the refusals above are the allowlist's.
      const allowed = await requestFromPage({
        page,
        request: { type: 'serverCall', serverId, method: 'GET', path: '/api/lock', body: null },
      })
      expect(allowed?.type ?? null).toBe('serverReply')
      expect(routesOf(fixture.requests.slice(probed))).toEqual(['GET /api/lock'])
      expect(routesOf(fixture.elsewhere.requests)).toEqual([])
    } finally {
      await fixture.close()
    }
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
