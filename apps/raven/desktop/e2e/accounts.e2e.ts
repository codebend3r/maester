import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  AUTH_PARAMS,
  AUTH_PATHS,
  AUTH_ROUTES,
  MEMBER_STATUSES,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  type PlayerEvent,
  playLinkFor,
} from '@raven/core'
import { expect, type Page, test } from '@playwright/test'
import { CLIP_SECONDS, makeClips, makeTrackClip } from '@/e2e/clips'
import { AUTH_V1, FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_KINDS } from '@/e2e/fixtureAuth'
import {
  FIXTURE_ADMIN_KINDS,
  FIXTURE_MEDIA,
  type FixtureRequest,
  type FixtureServer,
  isRelayed,
  MEDIA_PATHS,
  startFixtureServer,
} from '@/e2e/fixtureServer'
import {
  browserOpens,
  freshUserData,
  openUrl,
  removeDir,
  stubBrowser,
  stubTrustPrompt,
  TRUST_ANSWERS,
  withApp,
} from '@/e2e/harness'
import { tapPlayerPort, trafficOf } from '@/e2e/playerPort'
import { ACCOUNTS_DIR, SAFE_STORAGE_HOOK, SAFE_STORAGE_OFF } from '@/main/accounts/sessionStore'
import { ERROR_CODES } from '@/main/stateStore'
import { SERVER_METHODS } from '@/shared/protocol'

const PIN = '3001'
// The attribute the player sets on the page while mpv draws under it.
const SURFACE = { attribute: 'data-surface', native: 'native' } as const
// Shorter than a seek apart, so every seek below finds the relay's ticket expired at the server.
const TICKET_MS = 1500
const JWT_SECONDS = 3600
// Where the fixture starts to trickle the file: past the first second, so mpv's cache never
// holds the stretch a seek lands in and every seek is a new request through the relay.
const THROTTLE_SHARE = 0.1
// The digit keys jump to a tenth of the clip each, latest first, so each lands where mpv has
// read nothing yet.
const SEEK_KEYS = ['7', '4', '2'] as const
const SEEK_SHARE = 0.1
// A ticket's life and a margin between seeks, by the fixture's clock and raven player's.
const SEEK_GAP_MS = TICKET_MS + 500
// The clock reads whole seconds, and a seek lands on the frame before its target.
const SEEK_SLACK_S = 2
// Long enough for a stray request mpv still had to make to reach the fixture.
const QUIET_MS = 2000
// Three seeks a ticket's life apart, on top of the launch, the sign in and the play.
const SEEK_TEST_MS = 120_000

type FixtureClips = { first: string; second: string; tracks: string }

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

const linkTo = ({ fixture }: { fixture: FixtureServer }) =>
  playLinkFor({ origin: fixture.origin, mediaId: FIXTURE_MEDIA.first, at: 0, next: [] })

/** The server's name until it is renamed: its origin's host, with the port. */
const hostOf = ({ fixture }: { fixture: FixtureServer }) => new URL(fixture.origin).host

const ticketPath = AUTH_PATHS.ticket.replace(`:${AUTH_PARAMS.id}`, String(FIXTURE_MEDIA.first))

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

const expectClockMoving = async (page: Page) => {
  const start = await clockOf(page)
  await expect.poll(async () => (await clockOf(page)) - start).toBeGreaterThan(1)
}

/** mpv plays the title: the page has no `<video>`, its clock moves, and main says it is native. */
const expectPlayingNatively = async ({ page }: { page: Page }) => {
  await expect(heading({ page, name: 'Fixture One' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute(SURFACE.attribute, SURFACE.native)
  await expectButton({ page, name: 'Pause (k)' })
  await expectClockMoving(page)
}

const subtitleGroup = (page: Page) => page.getByRole('group', { name: 'Subtitles' })

const openSettings = async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible()
}

/** Fills the sign-in form on screen and sends it. */
const signIn = async ({ page }: { page: Page }) => {
  await page.getByLabel('Email', { exact: true }).fill(FIXTURE_ACCOUNT.email)
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_ACCOUNT.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

/** Adds the server in Settings, which asks main's trust sheet first. */
const addServer = async ({ page, fixture }: { page: Page; fixture: FixtureServer }) => {
  await page.getByLabel('Server address').fill(fixture.origin)
  await page.getByRole('button', { name: 'Add server' }).click()
  await expect(page.getByText('Server added.')).toBeVisible()
}

/** Signs in from the server's row in Settings. */
const signInFromSettings = async ({ page, fixture }: { page: Page; fixture: FixtureServer }) => {
  await page.getByRole('button', { name: `Sign in to ${hostOf({ fixture })}` }).click()
  await signIn({ page })
  await expect(page.getByText(`Signed in as ${FIXTURE_ACCOUNT.email}.`)).toBeVisible()
}

const filesOf = (requests: readonly FixtureRequest[]) =>
  requests.filter(
    ({ method, path }) =>
      method === SERVER_METHODS.get && path === MEDIA_PATHS.file(FIXTURE_MEDIA.first),
  )

const mintsOf = (requests: readonly FixtureRequest[]) =>
  requests.filter(({ method, path }) => method === SERVER_METHODS.post && path === ticketPath)

/** The sign-ins main keeps on disk, one encrypted file per server; none before it made the folder. */
const keptSignIns = async ({ userData }: { userData: string }): Promise<Buffer[]> => {
  const dir = join(userData, ACCOUNTS_DIR)
  const names = await readdir(dir).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === ERROR_CODES.enoent) return []
    throw error
  })
  return Promise.all(names.map((name) => readFile(join(dir, name))))
}

const isAccountError = (event: PlayerEvent) =>
  event.type === PLAYER_EVENTS.error && event.reason === PLAYER_ERROR_REASONS.account

/** Holds the file at a share of its bytes, so mpv reads only what a seek asks for past it. */
const throttleFile = async ({ fixture }: { fixture: FixtureServer }) => {
  const { size } = await stat(fixtureClips.tracks)
  fixture.throttle({ byte: Math.floor(size * THROTTLE_SHARE) })
}

test.describe.serial('a raven server whose accounts are on', () => {
  let userData = ''
  let started: FixtureServer | null = null

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    started = await startFixtureServer({
      clips: fixtureClips,
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
  })

  test.afterAll(async () => {
    const closing = started === null ? Promise.resolve() : started.close()
    await closing.finally(() => removeDir(userData))
  })

  test.afterEach(() => {
    server().throttle({ byte: null })
    server().setStatus(MEMBER_STATUSES.approved)
  })

  test('signs in from Settings, then seeks past ticket after ticket and picks the sidecar', async () => {
    test.setTimeout(SEEK_TEST_MS)
    const fixture = server()
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
        await stubBrowser({ app })
        await openSettings({ page })
        await addServer({ page, fixture })
        await expect(page.getByText('Not signed in.')).toBeVisible()
        await page.getByRole('button', { name: `Sign in to ${hostOf({ fixture })}` }).click()
        await page.getByRole('button', { name: 'Create account' }).click()
        await expect
          .poll(() => browserOpens({ app }))
          .toEqual([`${fixture.origin}${AUTH_ROUTES.signUp}`])
        await signIn({ page })
        await expect(page.getByText(`Signed in as ${FIXTURE_ACCOUNT.email}.`)).toBeVisible()
        await page.getByRole('button', { name: 'Back' }).click()
        await expect(homeHeading(page)).toBeVisible()

        await tapPlayerPort({ page })
        await throttleFile({ fixture })
        const from = fixture.requests.length
        await openUrl({ app, url: linkTo({ fixture }) })
        await expectPlayingNatively({ page })
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Play (k)' })

        // Each seek lands where mpv has read nothing, a ticket's life after the last request.
        await SEEK_KEYS.reduce(async (previous, key) => {
          await previous
          await delay(SEEK_GAP_MS)
          const mark = fixture.requests.length
          const minted = mintsOf(fixture.requests).length
          await page.keyboard.press(key)
          const target = Number(key) * SEEK_SHARE * CLIP_SECONDS
          await expect
            .poll(async () => Math.abs((await clockOf(page)) - target))
            .toBeLessThanOrEqual(SEEK_SLACK_S)
          await expect.poll(() => filesOf(fixture.requests.slice(mark)).length).toBeGreaterThan(0)
          await expect.poll(() => mintsOf(fixture.requests).length).toBeGreaterThan(minted)
        }, Promise.resolve())

        await wake(page)
        await page.getByRole('button', { name: /^Subtitles/u }).click()
        await subtitleGroup(page).getByRole('radio', { name: /File/u }).check()
        await expect
          .poll(async () => {
            const { requests, replies } = await trafficOf({ page })
            const sentId =
              requests.findLast(({ command }) => command.type === PLAYER_COMMANDS.subtitle)?.id ??
              null
            return replies.find(({ id }) => id === sentId)?.ok ?? null
          })
          .toBe(true)
        await page.getByRole('button', { name: 'Close menu' }).click()
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Pause (k)' })
        await expectClockMoving(page)

        const played = fixture.requests.slice(from)
        const files = filesOf(played)
        expect(files.length).toBeGreaterThan(SEEK_KEYS.length)
        expect(files.every(isRelayed)).toBe(true)
        const sidecars = played.filter(
          ({ method, path }) =>
            method === SERVER_METHODS.get && path === MEDIA_PATHS.sidecar(FIXTURE_MEDIA.first),
        )
        expect(sidecars).toHaveLength(1)
        expect(sidecars.every(isRelayed)).toBe(true)
        const mints = mintsOf(played)
        expect(mints.length).toBeGreaterThan(SEEK_KEYS.length)
        expect(mints.every(({ hasBearer }) => hasBearer)).toBe(true)
        const { events } = await trafficOf({ page })
        expect(events.filter(({ type }) => type === PLAYER_EVENTS.error)).toEqual([])
      },
    })
  })

  test('is still signed in after a relaunch, from a sign-in kept encrypted', async () => {
    const kept = await keptSignIns({ userData })
    expect(kept).toHaveLength(1)
    const secrets = [FIXTURE_ACCOUNT.email, ...server().issuedTokens()]
    const blob = kept.map((data) => data.toString('latin1')).join('')
    expect(secrets.filter((secret) => blob.includes(secret))).toEqual([])
    await withApp({
      userData,
      run: async ({ page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await openSettings({ page })
        await expect(page.getByText(`Signed in as ${FIXTURE_ACCOUNT.email}.`)).toBeVisible()
      },
    })
  })

  test('waits for approval, and Check again plays the title once the owner approves', async () => {
    const fixture = server()
    fixture.setStatus(MEMBER_STATUSES.pending)
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        const from = fixture.requests.length
        await openUrl({ app, url: linkTo({ fixture }) })
        await expect(heading({ page, name: 'Waiting for approval' })).toBeVisible()
        expect(mintsOf(fixture.requests.slice(from))).toEqual([])
        expect(filesOf(fixture.requests.slice(from))).toEqual([])
        fixture.setStatus(MEMBER_STATUSES.approved)
        await page.getByRole('button', { name: 'Check again' }).click()
        await expectPlayingNatively({ page })
      },
    })
  })

  test('says access was removed when the owner removes it mid-play, and asks for nothing more', async () => {
    const fixture = server()
    const host = hostOf({ fixture })
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await tapPlayerPort({ page })
        await throttleFile({ fixture })
        await openUrl({ app, url: linkTo({ fixture }) })
        await expectPlayingNatively({ page })
        fixture.setStatus(MEMBER_STATUSES.revoked)
        // A seek past what mpv holds is the next request the server hears.
        await page.keyboard.press(SEEK_KEYS[0])
        await expect
          .poll(async () => (await trafficOf({ page })).events.filter(isAccountError))
          .toEqual([
            {
              type: PLAYER_EVENTS.error,
              reason: PLAYER_ERROR_REASONS.account,
              message: `Your access to ${host} was removed.`,
            },
          ])
        await expect(heading({ page, name: 'Your access was removed' })).toBeVisible()
        await expect(
          page.getByText(`The owner of this server removed access for ${FIXTURE_ACCOUNT.email}.`),
        ).toBeVisible()
        const settled = filesOf(fixture.requests).length
        await delay(QUIET_MS)
        expect(filesOf(fixture.requests)).toHaveLength(settled)
      },
    })
  })

  test('is signed out after a relaunch that cannot keep the sign-in, and says why', async () => {
    const fixture = server()
    await withApp({
      userData,
      env: { [SAFE_STORAGE_HOOK]: SAFE_STORAGE_OFF },
      run: async ({ page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await openSettings({ page })
        await expect(page.getByText('Not signed in.')).toBeVisible()
        await page.getByRole('button', { name: `Sign in to ${hostOf({ fixture })}` }).click()
        await expect(
          page.getByText(
            'raven player cannot keep your sign-in on this Mac, so you sign in again after quitting.',
          ),
        ).toBeVisible()
      },
    })
    // Nothing is left on disk, in the clear or otherwise.
    expect(await keptSignIns({ userData })).toEqual([])
  })

  test('signs out, and a title then asks to sign in again', async () => {
    const fixture = server()
    const host = hostOf({ fixture })
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await openSettings({ page })
        // The launch that could not keep the sign-in removed the one kept on disk.
        await expect(page.getByText('Not signed in.')).toBeVisible()
        await signInFromSettings({ page, fixture })
        const from = fixture.requests.length
        await page.getByRole('button', { name: `Sign out of ${host}` }).click()
        await expect(page.getByText(`Signed out of ${host}.`)).toBeVisible()
        // auth-js names the scope in the query: this sign-in alone.
        expect(
          fixture.requests
            .slice(from)
            .some(
              ({ method, path }) =>
                method === SERVER_METHODS.post &&
                new URL(path, fixture.origin).pathname === AUTH_V1.logout,
            ),
        ).toBe(true)
        await page.getByRole('button', { name: 'Back' }).click()
        await expect(homeHeading(page)).toBeVisible()

        const signedOut = fixture.requests.length
        await openUrl({ app, url: linkTo({ fixture }) })
        await expect(heading({ page, name: 'Account needed' })).toBeVisible()
        await expect(page.getByText(`Sign in to ${host} to play this title.`)).toBeVisible()
        await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
        const asked = fixture.requests.slice(signedOut)
        expect(mintsOf(asked)).toEqual([])
        expect(filesOf(asked)).toEqual([])
        expect(asked.some(({ hasBearer }) => hasBearer)).toBe(false)
      },
    })
  })
})
