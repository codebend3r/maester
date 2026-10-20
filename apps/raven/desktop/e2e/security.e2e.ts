import { execFile } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AUTH_PARAMS, AUTH_PATHS, MEMBER_STATUSES, playLinkFor } from '@raven/core'
import { expect, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import {
  ACCOUNT_TICKET_PREFIX,
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_KINDS,
  FIXTURE_PUBLISHABLE_KEY,
} from '@/e2e/fixtureAuth'
import {
  FIXTURE_ADMIN_KINDS,
  FIXTURE_MEDIA,
  MEDIA_PATHS,
  routesOf,
  startFixtureServer,
  UNLOCK_COOKIE,
} from '@/e2e/fixtureServer'
import { API_PATHS } from '@/main/servers/allowlist'
import { RELAY_HOST, RELAY_SECRET_BYTES } from '@/main/servers/mediaRelay'
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
  TRUST_ANSWERS,
  trustPrompts,
  withApp,
} from '@/e2e/harness'
import { tapPlayerPort, trafficOf } from '@/e2e/playerPort'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  isDesktopReply,
  SERVER_METHODS,
} from '@/shared/protocol'

// Written out rather than imported, so the test checks the header against the spec, not
// against the module that sends it.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; media-src 'self' raven-file:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

const NAVIGATION_KEY = 'ravenE2eNavigation'

const PAGE_FETCHES = { reached: 'reached', blocked: 'blocked' } as const

const PIN = '3001'
// The unlock cookie's value the redirecting server sets, to look for where it goes.
const REDIRECT_UNLOCK = 'a.b'
// The real server's: five minutes, and Supabase's hour.
const TICKET_MS = 300_000
const JWT_SECONDS = 3600

// `lsof -Fn` prints each socket's name on a line that starts with this field letter.
const LSOF_NAME_FIELD = 'n'

/** The loopback ports a process listens on, as `lsof` lists them; none when it lists nothing. */
const loopbackPorts = ({ pid }: { pid: number }) =>
  new Promise<number[]>((resolve) => {
    execFile(
      'lsof',
      ['-a', '-p', `${pid}`, '-iTCP', '-sTCP:LISTEN', '-n', '-P', `-F${LSOF_NAME_FIELD}`],
      (_error, stdout) =>
        resolve(
          stdout.split('\n').flatMap((line) => {
            const [host = '', port = ''] = line.slice(LSOF_NAME_FIELD.length).split(':')
            const isLoopback = line.startsWith(LSOF_NAME_FIELD) && host === RELAY_HOST
            return isLoopback && /^\d+$/u.test(port) ? [Number(port)] : []
          }),
        ),
    )
  })

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
        response.writeHead(200, { [HTTP_HEADERS.contentType]: 'application/json' })
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
          await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
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
          // The probe's first read is the public auth config, and it goes no further.
          expect(redirecting.requests).toEqual([`${SERVER_METHODS.get} ${AUTH_PATHS.config}`])
          expect(elsewhere.requests).toEqual([])
          expect(
            await requestFromPage({ page, request: { type: DESKTOP_REQUESTS.listServers } }),
          ).toEqual({
            type: DESKTOP_REPLIES.servers,
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
        response.writeHead(200, { [HTTP_HEADERS.contentType]: 'application/json' })
        response.end('{}')
      },
    })
    const redirecting = await startListener({
      answer: ({ request, response }) => {
        // A server older than accounts, so the probe goes on to the lock.
        if (request.url === AUTH_PATHS.config) {
          response.writeHead(404, { [HTTP_HEADERS.contentType]: 'application/json' })
          response.end('{"message":"Not found"}')
          return
        }
        if (request.url === API_PATHS.lock) {
          response.writeHead(200, {
            [HTTP_HEADERS.contentType]: 'application/json',
            [HTTP_HEADERS.setCookie]: `${UNLOCK_COOKIE}=${REDIRECT_UNLOCK}; Path=/api; HttpOnly; SameSite=Strict`,
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
          await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
          await stubBrowser({ app })
          await openUrl({
            app,
            url: playLinkFor({ origin: redirecting.origin, mediaId: 1, at: 0, next: [] }),
          })
          await expect(
            page.getByText(`raven player could not reach ${redirecting.host}.`),
          ).toBeVisible()
          // The trust probe reads the auth config and the lock; the title's page reads the
          // config once more for the account, which it keeps from then on.
          const config = `${SERVER_METHODS.get} ${AUTH_PATHS.config}`
          expect(redirecting.requests).toEqual([
            config,
            `${SERVER_METHODS.get} ${API_PATHS.lock}`,
            config,
            `${SERVER_METHODS.get} ${MEDIA_PATHS.item(FIXTURE_MEDIA.first)}`,
          ])
          const unlock = `${UNLOCK_COOKIE}=${REDIRECT_UNLOCK}`
          expect(redirecting.cookies).toEqual(['', '', unlock, unlock])
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
      mode: { pin: PIN, isLocked: false, admin: { kind: FIXTURE_ADMIN_KINDS.off } },
    })
    try {
      await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
      const added = await requestFromPage({
        page,
        request: { type: DESKTOP_REQUESTS.addServer, origin: fixture.origin },
      })
      const [serverId = ''] =
        added !== null && added.type === DESKTOP_REPLIES.servers
          ? added.servers.map((s) => s.serverId)
          : []
      expect(serverId).not.toBe('')
      const listed = await requestFromPage({
        page,
        request: { type: DESKTOP_REQUESTS.listServers },
      })
      expect(
        listed !== null && listed.type === DESKTOP_REPLIES.servers
          ? listed.servers.map((s) => s.serverId)
          : [],
      ).toEqual([serverId])
      const probed = fixture.requests.length

      // Real server routes the page has no business calling, and allowed ones bent out of shape.
      const forgeries = [
        { method: SERVER_METHODS.get, path: '/api/media/1/location', body: null },
        { method: SERVER_METHODS.get, path: '/api/admin/settings', body: null },
        { method: SERVER_METHODS.put, path: '/api/admin/settings', body: '{"pin":"0000"}' },
        { method: SERVER_METHODS.get, path: '/api/media/1/file', body: null },
        { method: SERVER_METHODS.get, path: '/api/media/1?x=1', body: null },
        { method: SERVER_METHODS.get, path: '/api/media/1/../../admin/settings', body: null },
        { method: SERVER_METHODS.get, path: `${fixture.elsewhere.origin}/api/media/1`, body: null },
        { method: SERVER_METHODS.post, path: '/api/media/1/plays', body: '{"extra":true}' },
      ]
      const replies = await Promise.all(
        forgeries.map((forgery) =>
          requestFromPage({
            page,
            request: { type: DESKTOP_REQUESTS.serverCall, serverId, ...forgery },
          }),
        ),
      )
      expect(replies).toEqual(
        forgeries.map(() => ({
          type: DESKTOP_REPLIES.serverUnreachable,
          message: 'raven player does not make that call.',
        })),
      )

      const unknown = await requestFromPage({
        page,
        request: {
          type: DESKTOP_REQUESTS.serverCall,
          serverId: '00000000-0000-4000-8000-000000000000',
          method: SERVER_METHODS.get,
          path: '/api/media/1',
          body: null,
        },
      })
      expect(unknown).toEqual({
        type: DESKTOP_REPLIES.serverUnreachable,
        message: 'That server is no longer in raven player.',
      })

      // A call on the list still goes through, so the refusals above are the allowlist's.
      const allowed = await requestFromPage({
        page,
        request: {
          type: DESKTOP_REQUESTS.serverCall,
          serverId,
          method: SERVER_METHODS.get,
          path: API_PATHS.lock,
          body: null,
        },
      })
      expect(allowed?.type ?? null).toBe(DESKTOP_REPLIES.serverReply)
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
        type: DESKTOP_REPLIES.refused,
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

test.describe('a raven server whose accounts are on', () => {
  test("keeps the sign-in's tokens, its account calls and the relay out of the page's reach", async () => {
    const userData = await freshUserData()
    const clips = await makeClips()
    const fixture = await startFixtureServer({
      clips: { first: clips.first, second: clips.second, tracks: clips.first },
      mode: {
        pin: PIN,
        isLocked: false,
        admin: { kind: FIXTURE_ADMIN_KINDS.off },
        accounts: {
          kind: FIXTURE_ACCOUNT_KINDS.ready,
          status: MEMBER_STATUSES.approved,
          ticketMs: TICKET_MS,
          jwtSeconds: JWT_SECONDS,
        },
      },
    })
    try {
      await withApp({
        userData,
        run: async ({ app, page }) => {
          await expect(page.getByRole('heading', { name: 'raven player' })).toBeVisible()
          await tapPlayerPort({ page })
          await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
          const added = await requestFromPage({
            page,
            request: { type: DESKTOP_REQUESTS.addServer, origin: fixture.origin },
          })
          const [serverId = ''] =
            added !== null && added.type === DESKTOP_REPLIES.servers
              ? added.servers.map((server) => server.serverId)
              : []
          expect(serverId).not.toBe('')
          const signedIn = await requestFromPage({
            page,
            request: {
              type: DESKTOP_REQUESTS.signIn,
              serverId,
              email: FIXTURE_ACCOUNT.email,
              password: FIXTURE_ACCOUNT.password,
            },
          })
          expect(signedIn?.type ?? null).toBe(DESKTOP_REPLIES.account)
          const read = await requestFromPage({
            page,
            request: { type: DESKTOP_REQUESTS.readAccount, serverId },
          })

          // main makes these three itself, with the Bearer; the page may ask for none of them.
          const asked = fixture.requests.length
          const forgeries = [
            { method: SERVER_METHODS.get, path: AUTH_PATHS.config, body: null },
            { method: SERVER_METHODS.get, path: AUTH_PATHS.me, body: null },
            {
              method: SERVER_METHODS.post,
              path: AUTH_PATHS.ticket.replace(`:${AUTH_PARAMS.id}`, String(FIXTURE_MEDIA.first)),
              body: null,
            },
          ]
          const refused = await Promise.all(
            forgeries.map((forgery) =>
              requestFromPage({
                page,
                request: { type: DESKTOP_REQUESTS.serverCall, serverId, ...forgery },
              }),
            ),
          )
          expect(refused).toEqual(
            forgeries.map(() => ({
              type: DESKTOP_REPLIES.serverUnreachable,
              message: 'raven player does not make that call.',
            })),
          )
          expect(routesOf(fixture.requests.slice(asked))).toEqual([])

          // The relay listens from the first title it plays: the one loopback port that is new.
          const pid = app.process().pid ?? 0
          const before = await loopbackPorts({ pid })
          await openUrl({
            app,
            url: playLinkFor({
              origin: fixture.origin,
              mediaId: FIXTURE_MEDIA.first,
              at: 0,
              next: [],
            }),
          })
          await expect(
            page.getByRole('heading', { name: 'Fixture One', exact: true }),
          ).toBeVisible()
          await expect
            .poll(async () =>
              (await loopbackPorts({ pid })).filter((port) => !before.includes(port)),
            )
            .toHaveLength(1)
          const relayPort =
            (await loopbackPorts({ pid })).find((port) => !before.includes(port)) ?? 0
          const relay = `http://${RELAY_HOST}:${relayPort}`
          const fetched = await page.evaluate(
            async ({ url, outcomes }) => {
              try {
                // Opaque answers count: only the content security policy can refuse this.
                await fetch(url, { mode: 'no-cors' })
                return outcomes.reached
              } catch {
                return outcomes.blocked
              }
            },
            { url: `${relay}/`, outcomes: PAGE_FETCHES },
          )
          expect(fetched).toBe(PAGE_FETCHES.blocked)
          // The relay itself answers a path it was not given with a 404, and sends nothing on.
          const heard = fixture.requests.length
          const stale = Buffer.alloc(RELAY_SECRET_BYTES).toString('base64url')
          expect((await fetch(`${relay}/${stale}/file`)).status).toBe(404)
          expect(fixture.requests.length).toBe(heard)

          const tokens = fixture.issuedTokens()
          expect(tokens.length).toBeGreaterThan(2)
          const seen = [
            JSON.stringify([added, signedIn, read]),
            JSON.stringify(await trafficOf({ page })),
            await page.content(),
          ]
          const unseen = [
            ...tokens,
            FIXTURE_ACCOUNT.password,
            FIXTURE_PUBLISHABLE_KEY,
            'eyJ',
            ACCOUNT_TICKET_PREFIX,
            `:${relayPort}`,
          ]
          expect(
            seen.flatMap((text) => unseen.filter((secret) => text.includes(secret))),
            'the page holds a token, a ticket, the key or the relay',
          ).toEqual([])
        },
      })
    } finally {
      await fixture.close()
      await Promise.all([removeDir(userData), removeDir(clips.folder)])
    }
  })
})
