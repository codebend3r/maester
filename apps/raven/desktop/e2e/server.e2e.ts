import { type PlayRequest, playLinkFor } from '@raven/core'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { makeClips, makeTrackClip } from '@/e2e/clips'
import {
  FIXTURE_MEDIA,
  type FixtureAdmin,
  type FixtureRequest,
  type FixtureServer,
  routesOf,
  startFixtureServer,
} from '@/e2e/fixtureServer'
import type { ServerMethod } from '@/main/servers/allowlist'
import { SERVER_METHODS } from '@/shared/protocol'
import {
  browserOpens,
  closeApp,
  freshUserData,
  isMarkLine,
  launchApp,
  markWithin,
  openUrl,
  type Output,
  removeDir,
  requestFromPage,
  serverPartitions,
  stubBrowser,
  stubTrustPrompt,
  trustPrompts,
  withApp,
} from '@/e2e/harness'
import { DESKTOP_REPLIES } from '@/shared/protocol'

const PIN = '3001'
const ADMIN_PASSWORD = 'raven fixture admin'
const NEXT_WAIT_MS = 15_000
// Spec Review Focus 5, as for a local file: mpv is destroyed and the app gone within a second,
// read from main's own mark. The wall clock only guards against a hang.
const QUIT_LIMIT_MS = 1000
const QUIT_HANG_MS = 3000
const QUIT_MARK_WAIT_MS = 1000
// The fixture's clips run 30 s.
const CLIP_SECONDS = 30
// The clock reads whole seconds, and a moment passes between the read and the save.
const SAVE_SLACK_S = 2
// The fixture's wrong-try wait, passed on its clock instead of waited out.
const WRONG_WAIT_MS = 60_000

type FixtureClips = { first: string; second: string; tracks: string }

// The clips every fixture in this file serves, and the folders to remove after.
let fixtureClips: FixtureClips = { first: '', second: '', tracks: '' }
let clipFolders: string[] = []

test.beforeAll(async () => {
  const [clips, track] = await Promise.all([makeClips(), makeTrackClip()])
  fixtureClips = { first: clips.first, second: clips.second, tracks: track.path }
  clipFolders = [clips.folder, track.folder]
})

test.afterAll(async () => {
  await Promise.all(clipFolders.map((dir) => removeDir(dir)))
})

/** A locked fixture, PIN `3001`, whose clock a test can move past the wrong-try wait. */
const startLockedFixture = async ({ admin, skew }: { admin: FixtureAdmin; skew: { ms: number } }) =>
  startFixtureServer({
    clips: fixtureClips,
    mode: { pin: PIN, isLocked: true, admin },
    now: () => Date.now() + skew.ms,
  })

const linkTo = ({ fixture, ...rest }: { fixture: FixtureServer } & Omit<PlayRequest, 'origin'>) =>
  playLinkFor({ origin: fixture.origin, ...rest })

const promptFor = ({ fixture }: { fixture: FixtureServer }) =>
  `Add the raven server at ${fixture.origin}?`

/** The server's name until it is renamed: its origin's host, with the port. */
const hostOf = ({ fixture }: { fixture: FixtureServer }) => new URL(fixture.origin).host

/** The requests a test made, from where the log stood when it started. */
const loggedSince = ({ fixture, from }: { fixture: FixtureServer; from: number }) =>
  fixture.requests.slice(from)

const requestsTo = ({
  requests,
  method,
  path,
}: {
  requests: readonly FixtureRequest[]
  method: ServerMethod
  path: string
}) => requests.filter((request) => request.method === method && request.path === path)

/** A body read as JSON, or null; never an error, which would print the body. */
const parseJson = ({ text }: { text: string | null }): unknown => {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return null
  }
}

/** The position each `PUT progress` for `mediaId` carried, null where it carried none. */
const savedPositions = ({
  requests,
  mediaId,
}: {
  requests: readonly FixtureRequest[]
  mediaId: number
}) =>
  requestsTo({ requests, method: SERVER_METHODS.put, path: `/api/media/${mediaId}/progress` }).map(
    ({ body }) => {
      const value = parseJson({ text: body })
      if (typeof value !== 'object' || value === null || !('position' in value)) return null
      return typeof value.position === 'number' ? value.position : null
    },
  )

/** A saved position within the clip and within a moment of `clock`, the second read before it. */
const isSavedNear = ({ position, clock }: { position: number | null; clock: number }) =>
  position !== null &&
  position > 0 &&
  position <= CLIP_SECONDS &&
  Math.abs(position - clock) <= SAVE_SLACK_S

const homeHeading = (page: Page) => page.getByRole('heading', { name: 'raven player' })

const heading = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('heading', { name, exact: true })

/** A pointer move wakes the controls, which hold their clock while hidden. */
const wake = async (page: Page) => {
  await page.mouse.move(120, 120)
  await page.mouse.move(160, 140)
}

const expectButton = async ({ page, name }: { page: Page; name: string }) => {
  await wake(page)
  await expect(page.getByRole('button', { name })).toBeVisible()
}

/** The scrubber's position in whole seconds, read with the controls awake. */
const clockOf = async (page: Page): Promise<number> => {
  await wake(page)
  const now = await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuenow')
  return now === null ? Number.NaN : Number(now)
}

/** mpv plays the title: the page has no `<video>`, its clock moves, and main says it is native. */
const expectPlayingNatively = async ({ page, title }: { page: Page; title: string }) => {
  await expect(heading({ page, name: title })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'native')
  await expectButton({ page, name: 'Pause (k)' })
  const start = await clockOf(page)
  await expect.poll(async () => (await clockOf(page)) - start).toBeGreaterThan(1)
}

const unlockDialog = ({ page, title }: { page: Page; title: 'Locked library' | 'Admin lock' }) =>
  page.getByRole('dialog', { name: title })

/** Types a secret into the open unlock dialog and waits for the server's answer to land. */
const enterSecret = async ({
  page,
  title,
  label,
  secret,
}: {
  page: Page
  title: 'Locked library' | 'Admin lock'
  label: 'PIN' | 'Admin password'
  secret: string
}) => {
  const dialog = unlockDialog({ page, title })
  const field = dialog.getByLabel(label, { exact: true })
  await field.fill(secret)
  await dialog.getByRole('button', { name: 'Unlock' }).click()
}

/** A wrong PIN: the dialog empties its field once the server's refusal is in. */
const enterWrongPin = async ({ page, message }: { page: Page; message: string }) => {
  const dialog = unlockDialog({ page, title: 'Locked library' })
  await enterSecret({ page, title: 'Locked library', label: 'PIN', secret: '1234' })
  await expect(dialog.getByRole('alert')).toHaveText(message)
  await expect(dialog.getByLabel('PIN', { exact: true })).toHaveValue('')
}

const unlockWithPin = async ({ page }: { page: Page }) => {
  await expect(unlockDialog({ page, title: 'Locked library' })).toBeVisible()
  await enterSecret({ page, title: 'Locked library', label: 'PIN', secret: PIN })
}

/** File > Open Link, chosen from the app's menu as Command L would. */
const chooseOpenLink = async ({ app }: { app: ElectronApplication }) => {
  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === 'File') ?? null
    const item = file?.submenu?.items.find((each) => each.label === 'Open Link…') ?? null
    if (item === null) throw new Error('raven player has no Open Link item.')
    item.click()
  })
}

const ESCAPED = /[.*+?^${}()|[\]\\]/gu

/** Whether `line` holds `secret` as a whole word, so a PIN does not match inside a longer number. */
const holdsSecret = ({ line, secret }: { line: string; secret: string }): boolean =>
  new RegExp(`(^|[^0-9A-Za-z])${secret.replace(ESCAPED, '\\$&')}($|[^0-9A-Za-z])`, 'u').test(line)

/**
 * Checks, once the app has quit, that main printed none of `secrets` (the cookie values the
 * fixture issued, the PIN, the admin password) on stdout or stderr. Budget marks carry only
 * a name and a number, so they are left out. The failure names no secret.
 */
const expectNothingSecretPrinted = ({
  output,
  issued,
  typed,
}: {
  output: Output
  /** The cookie values the fixture handed out. */
  issued: readonly string[]
  /** What the person typed: the PIN, the admin password. */
  typed: readonly string[]
}) => {
  const lines = output.lines()
  expect(lines.length, 'raven player printed nothing, so the check saw nothing').toBeGreaterThan(0)
  expect(issued.length, 'the fixture issued no cookie to look for').toBeGreaterThan(0)
  const secrets = [...issued, ...typed]
  const isLeaked = lines
    .filter((line) => !isMarkLine(line))
    .some((line) => secrets.some((secret) => holdsSecret({ line, secret })))
  expect(isLeaked, 'raven player printed a cookie value, the PIN or the admin password').toBe(false)
}

/** Opens Settings from Home. */
const openSettings = async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible()
}

const serverIdsOf = async ({ page }: { page: Page }): Promise<string[]> => {
  const reply = await requestFromPage({ page, request: { type: 'listServers' } })
  return reply !== null && reply.type === DESKTOP_REPLIES.servers
    ? reply.servers.map(({ serverId }) => serverId)
    : []
}

/** How many cookies a server's own session holds, read in main for this one partition. */
const sessionCookieCount = ({ app, serverId }: { app: ElectronApplication; serverId: string }) =>
  app.evaluate(
    async ({ session }, id) =>
      (await session.fromPartition(`persist:server:${id}`).cookies.get({})).length,
    serverId,
  )

test.describe.serial('playing a title from a locked raven server', () => {
  let userData = ''
  let started: FixtureServer | null = null
  const skew = { ms: 0 }

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    started = await startLockedFixture({ admin: { kind: 'off' }, skew })
  })

  test.afterAll(async () => {
    const closing = started === null ? Promise.resolve() : started.close()
    await closing.finally(() => removeDir(userData))
  })

  test('asks before trusting a server a link names, and fetches nothing when declined', async () => {
    const ownUserData = await freshUserData()
    const fixture = server()
    try {
      await withApp({
        userData: ownUserData,
        run: async ({ app, page }) => {
          await expect(homeHeading(page)).toBeVisible()
          await stubTrustPrompt({ app, answer: 'cancel' })
          await openUrl({ app, url: linkTo({ fixture, mediaId: 1, at: 0, next: [] }) })
          await expect.poll(() => trustPrompts({ app })).toEqual([promptFor({ fixture })])

          // Links ask about one server at a time, so the next prompt means the declined link
          // is done with: whatever it would fetch, it has fetched by then.
          await openUrl({
            app,
            url: playLinkFor({ origin: fixture.elsewhere.origin, mediaId: 1, at: 0, next: [] }),
          })
          await expect
            .poll(() => trustPrompts({ app }))
            .toEqual([
              promptFor({ fixture }),
              `Add the raven server at ${fixture.elsewhere.origin}?`,
            ])

          expect(routesOf(fixture.requests)).toEqual([])
          expect(routesOf(fixture.elsewhere.requests)).toEqual([])
          expect(await serverIdsOf({ page })).toEqual([])
          await expect(homeHeading(page)).toBeVisible()
        },
      })
      // No session was made for either server, not even an empty one.
      expect(await serverPartitions({ userData: ownUserData })).toEqual([])
    } finally {
      await removeDir(ownUserData)
    }
  })

  test('plays a locked title after the PIN, with the cookie sent to mpv, and saves progress there', async () => {
    const fixture = server()
    const from = fixture.requests.length
    const output = await withApp({
      userData,
      run: async ({ app, page, output: printed }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        await openUrl({ app, url: linkTo({ fixture, mediaId: 1, at: 0, next: [] }) })
        await expect(unlockDialog({ page, title: 'Locked library' })).toBeVisible()
        expect(await trustPrompts({ app })).toEqual([promptFor({ fixture })])
        // The probe after the yes is the first thing the server hears.
        expect(routesOf(loggedSince({ fixture, from })).at(0) ?? null).toBe('GET /api/lock')
        // Stored under its origin's host until someone renames it.
        const listed = await requestFromPage({ page, request: { type: 'listServers' } })
        expect(
          listed !== null && listed.type === DESKTOP_REPLIES.servers
            ? listed.servers.map(({ name, origin }) => ({ name, origin }))
            : [],
        ).toEqual([{ name: hostOf({ fixture }), origin: fixture.origin }])

        // Five wrong in a row make even the right PIN wait a minute.
        await [1, 2, 3, 4, 5].reduce(
          (previous) =>
            previous.then(() => enterWrongPin({ page, message: 'That PIN is not right.' })),
          Promise.resolve(),
        )
        await unlockWithPin({ page })
        await expect(unlockDialog({ page, title: 'Locked library' }).getByRole('alert')).toHaveText(
          'Too many wrong PINs. Try again in a minute.',
        )
        skew.ms += WRONG_WAIT_MS

        await unlockWithPin({ page })
        await expectPlayingNatively({ page, title: 'Fixture One' })

        const played = loggedSince({ fixture, from })
        const files = requestsTo({
          requests: played,
          method: SERVER_METHODS.get,
          path: '/api/media/1/file',
        })
        expect(files.length).toBeGreaterThan(0)
        expect(files.every(({ hasUnlock, hasOtherCookie }) => hasUnlock && !hasOtherCookie)).toBe(
          true,
        )
        const sidecars = requestsTo({
          requests: played,
          method: SERVER_METHODS.get,
          path: '/api/media/1/subtitles/external-0',
        })
        expect(sidecars.length).toBeGreaterThan(0)
        expect(sidecars.every(({ hasUnlock }) => hasUnlock)).toBe(true)

        const clock = await clockOf(page)
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Play (k)' })
        await expect
          .poll(() =>
            savedPositions({ requests: loggedSince({ fixture, from }), mediaId: 1 }).some(
              (position) => isSavedNear({ position, clock }),
            ),
          )
          .toBe(true)
        expect(
          routesOf(
            requestsTo({
              requests: loggedSince({ fixture, from }),
              method: SERVER_METHODS.post,
              path: '/api/media/1/plays',
            }),
          ),
        ).toEqual(['POST /api/media/1/plays'])
        return printed
      },
    })
    expectNothingSecretPrinted({ output, issued: fixture.issued(), typed: [PIN] })
  })

  test('asks for the PIN again after a relaunch, from the recent', async () => {
    const fixture = server()
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        const recent = page.getByRole('button', { name: /Fixture One/ })
        await expect(recent).toContainText(hostOf({ fixture }))
        await recent.click()
        await expect(unlockDialog({ page, title: 'Locked library' })).toBeVisible()
        expect(await trustPrompts({ app })).toEqual([])
      },
    })
  })

  test('plays the next title from the link', async () => {
    const fixture = server()
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await openUrl({ app, url: linkTo({ fixture, mediaId: 1, at: 0, next: [2] }) })
        await unlockWithPin({ page })
        await expectPlayingNatively({ page, title: 'Fixture One' })
        await page.keyboard.press('End')
        await expect(heading({ page, name: 'Fixture Two' })).toBeVisible({ timeout: NEXT_WAIT_MS })
        await expectPlayingNatively({ page, title: 'Fixture Two' })
      },
    })
  })

  test('stays on the title at its end when the link names nothing next', async () => {
    const fixture = server()
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await openUrl({ app, url: linkTo({ fixture, mediaId: 1, at: 0, next: [] }) })
        await unlockWithPin({ page })
        await expectPlayingNatively({ page, title: 'Fixture One' })
        const from = fixture.requests.length
        const url = page.url()
        await page.keyboard.press('End')
        // The end's save comes from the same render that would move on to a next title.
        await expect
          .poll(() =>
            savedPositions({ requests: loggedSince({ fixture, from }), mediaId: 1 }).some(
              (position) => position !== null && position >= CLIP_SECONDS - 1,
            ),
          )
          .toBe(true)
        await expect(heading({ page, name: 'Fixture One' })).toBeVisible()
        expect(page.url()).toBe(url)
        await wake(page)
        await expect(page.getByRole('link', { name: /^Next/ })).toHaveCount(0)
        expect(
          routesOf(loggedSince({ fixture, from })).filter((route) =>
            route.includes('/api/media/2'),
          ),
        ).toEqual([])
      },
    })
  })

  test('quits within a second while a server title plays, with its last position saved', async () => {
    const fixture = server()
    const launched = await launchApp({ userData })
    const { app, page } = launched
    try {
      await expect(homeHeading(page)).toBeVisible()
      await openUrl({ app, url: linkTo({ fixture, mediaId: 1, at: 0, next: [] }) })
      await unlockWithPin({ page })
      await expectPlayingNatively({ page, title: 'Fixture One' })
      const from = fixture.requests.length
      const clock = await clockOf(page)

      const startedAt = performance.now()
      await closeApp({ app })
      const wallMs = performance.now() - startedAt
      const quitMs = await markWithin({ launched, name: 'quit-ms', ms: QUIT_MARK_WAIT_MS })
      process.stdout.write(
        `raven server title quit ${quitMs} ms (main), ${Math.round(wallMs)} ms (test)\n`,
      )
      expect(quitMs).toBeLessThan(QUIT_LIMIT_MS)
      expect(wallMs).toBeLessThan(QUIT_HANG_MS)
      // The page's last save went out before the app was gone.
      const saved = savedPositions({ requests: loggedSince({ fixture, from }), mediaId: 1 })
      expect(saved.some((position) => isSavedNear({ position, clock }))).toBe(true)
    } finally {
      await closeApp({ app }).catch(() => undefined)
    }
  })

  test('adds, renames and removes a server in Settings, and removing signs out of it', async () => {
    const ownUserData = await freshUserData()
    const fixture = server()
    const host = hostOf({ fixture })
    await withApp({
      userData: ownUserData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        await openSettings({ page })
        await page.getByLabel('Server address').fill(fixture.origin)
        await page.getByRole('button', { name: 'Add server' }).click()
        await expect(page.getByText('Server added.')).toBeVisible()
        await expect(page.getByRole('button', { name: `Rename ${host}` })).toBeVisible()
        await page.getByRole('button', { name: 'Back' }).click()

        // A link to a server already added plays without asking again.
        await openUrl({ app, url: linkTo({ fixture, mediaId: 1, at: 0, next: [] }) })
        await unlockWithPin({ page })
        await expectPlayingNatively({ page, title: 'Fixture One' })
        expect(await trustPrompts({ app })).toEqual([promptFor({ fixture })])
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: /Fixture One/ })).toContainText(host)
        const [serverId = ''] = await serverIdsOf({ page })
        expect(serverId).not.toBe('')
        // The PIN left its cookie in the server's own session.
        expect(await sessionCookieCount({ app, serverId })).toBeGreaterThan(0)

        await openSettings({ page })
        await page.getByRole('button', { name: `Rename ${host}` }).click()
        await page.getByLabel(`Name for ${fixture.origin}`).fill('Fixture box')
        await page.getByRole('button', { name: 'Save' }).click()
        await expect(page.getByText('Renamed to Fixture box.')).toBeVisible()

        // Removing asks in the row first.
        await page.getByRole('button', { name: 'Remove Fixture box' }).click()
        await expect(
          page.getByText('Remove Fixture box? This signs raven player out of it.'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Remove', exact: true }).click()
        await expect(
          page.getByText('Removed Fixture box. raven player signed out of it.'),
        ).toBeVisible()
        await expect(page.getByText('No servers yet.', { exact: false })).toBeVisible()
        expect(await serverIdsOf({ page })).toEqual([])
        expect(await sessionCookieCount({ app, serverId })).toBe(0)

        await page.getByRole('button', { name: 'Back' }).click()
        await expect(homeHeading(page)).toBeVisible()
        await expect(page.getByText('Nothing opened yet.')).toBeVisible()

        // A pasted watch page names the server again: it is new, so main asks, and its
        // new session asks for the PIN.
        await chooseOpenLink({ app })
        const openLink = page.getByRole('dialog', { name: 'Open a link' })
        await openLink.getByLabel('Link', { exact: true }).fill(`${fixture.origin}/watch/1`)
        await openLink.getByRole('button', { name: 'Open', exact: true }).click()
        await expect(unlockDialog({ page, title: 'Locked library' })).toBeVisible()
        expect(await trustPrompts({ app })).toEqual([
          promptFor({ fixture }),
          promptFor({ fixture }),
        ])
      },
    }).finally(() => removeDir(ownUserData))
  })
})

test.describe('playing a title while the admin lock hides it', () => {
  let userData = ''
  let fixture: FixtureServer | null = null

  test.beforeAll(async () => {
    userData = await freshUserData()
    fixture = await startLockedFixture({
      admin: { kind: 'password', password: ADMIN_PASSWORD },
      skew: { ms: 0 },
    })
  })

  test.afterAll(async () => {
    const closing = fixture === null ? Promise.resolve() : fixture.close()
    await closing.finally(() => removeDir(userData))
  })

  test('asks for the admin password first while the admin lock hides the title', async () => {
    if (fixture === null) throw new Error('The fixture server is not running.')
    const running = fixture
    const output = await withApp({
      userData,
      run: async ({ app, page, output: printed }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        await openUrl({ app, url: linkTo({ fixture: running, mediaId: 1, at: 0, next: [] }) })
        await expect(unlockDialog({ page, title: 'Admin lock' })).toBeVisible()
        await enterSecret({
          page,
          title: 'Admin lock',
          label: 'Admin password',
          secret: ADMIN_PASSWORD,
        })
        await unlockWithPin({ page })
        await expectPlayingNatively({ page, title: 'Fixture One' })
        const files = requestsTo({
          requests: running.requests,
          method: SERVER_METHODS.get,
          path: '/api/media/1/file',
        })
        expect(files.length).toBeGreaterThan(0)
        expect(files.every(({ hasUnlock, hasAdmin }) => hasUnlock && hasAdmin)).toBe(true)
        return printed
      },
    })
    expectNothingSecretPrinted({
      output,
      issued: running.issued(),
      typed: [PIN, ADMIN_PASSWORD],
    })
  })
})

test.describe('a server title without the video engine', () => {
  let userData = ''
  let fixture: FixtureServer | null = null

  test.beforeAll(async () => {
    userData = await freshUserData()
    fixture = await startLockedFixture({ admin: { kind: 'off' }, skew: { ms: 0 } })
  })

  test.afterAll(async () => {
    const closing = fixture === null ? Promise.resolve() : fixture.close()
    await closing.finally(() => removeDir(userData))
  })

  test('opens the title in the browser without the video engine', async () => {
    if (fixture === null) throw new Error('The fixture server is not running.')
    const running = fixture
    await withApp({
      userData,
      mpv: 'off',
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        await stubBrowser({ app })
        await openUrl({
          app,
          url: linkTo({ fixture: running, mediaId: FIXTURE_MEDIA.first, at: 0, next: [] }),
        })
        await expect(page.getByRole('heading', { name: 'Opened in your browser' })).toBeVisible()
        await expect.poll(() => browserOpens({ app })).toEqual([`${running.origin}/watch/1`])
        // Only the trust probe: the page has no engine to read the title for.
        expect(routesOf(running.requests)).toEqual(['GET /api/lock'])
      },
    })
  })
})
