import { chmod, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DOWNLOAD_TARGET_KINDS, downloadLinkFor, MEMBER_STATUSES, playLinkFor } from '@raven/core'
import { expect, type Page, test } from '@playwright/test'
import { type Clips, makeClips, makeTrackClip } from '@/e2e/clips'
import {
  ACCOUNT_TICKET_PREFIX,
  AUTH_V1,
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_KINDS,
  GRANT_PARAM,
  GRANTS,
} from '@/e2e/fixtureAuth'
import {
  FIXTURE_ADMIN_KINDS,
  FIXTURE_MEDIA,
  type FixtureServer,
  isRelayed,
  MEDIA_PATHS,
  startFixtureServer,
} from '@/e2e/fixtureServer'
import {
  freshUserData,
  isMarkLine,
  logPathFor,
  openFile,
  openUrl,
  readLog,
  removeDir,
  requestFromPage,
  stubTrustPrompt,
  TRUST_ANSWERS,
  withApp,
} from '@/e2e/harness'
import {
  ACCOUNT_STATES,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  SERVER_METHODS,
} from '@/shared/protocol'

const PIN = '3001'
// What the fixture's title plays for before the app quits.
const PLAY_SECONDS = 3
// A ticket's life at the fixture, shorter than the wait before each seek, so each seek mints anew.
const TICKET_MS = 1000
// Shorter than the six minutes a ticket asks of its JWT, so every mint refreshes the session first.
const JWT_SECONDS = 120
// A download is a local copy of a small clip.
const DOWNLOAD_WAIT_MS = 15_000
// Each a tenth of the clip, latest first: every seek lands where mpv has read nothing.
const SEEK_KEYS = ['7', '4'] as const
const SECONDS_PER_KEY = 3
// The clock reads whole seconds, and a seek lands on the frame before its target.
const SEEK_SLACK_S = 2
// Where the fixture starts to trickle the file, so a seek past it is a request of its own.
const THROTTLE_SHARE = 0.1

// Each a sign-in secret in a shape the log must never hold, whoever's it is: a Bearer token
// not blanked, a JWT, an account ticket, and a run of exactly 43 base64url characters, the
// shape of the relay's per-load secret.
const SECRET_SHAPES = [
  /Bearer(?:\s|%20)+(?!\[redacted\])/u,
  /eyJ/u,
  new RegExp(`${ACCOUNT_TICKET_PREFIX.replace('.', '\\.')}[A-Za-z0-9_-]{8,}`, 'u'),
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?:[^A-Za-z0-9_-]|$)/u,
] as const

const homeHeading = (page: Page) => page.getByRole('heading', { name: 'raven player' })

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

/** Waits until a line of the log holds `text`, which main writes a moment after it happens. */
const expectLogged = async ({ userData, text }: { userData: string; text: string }) => {
  await expect
    .poll(async () => (await readLog({ userData })).some((line) => line.includes(text)))
    .toBe(true)
}

/** Where the first line holding `text` sits in the log, or -1. */
const indexOf = ({ lines, text }: { lines: readonly string[]; text: string }) =>
  lines.findIndex((line) => line.includes(text))

// A budget mark as the log holds it: a stamp, its level, then only a name and a number.
const MARK_ENTRY = /^\S+ info raven-[a-z][a-z0-9-]* \d+$/

const ESCAPED = /[.*+?^${}()|[\]\\]/gu

/** Whether `line` holds `secret` as a whole word, so a PIN does not match inside a longer number. */
const holdsSecret = ({ line, secret }: { line: string; secret: string }): boolean =>
  new RegExp(`(^|[^0-9A-Za-z])${secret.replace(ESCAPED, '\\$&')}($|[^0-9A-Za-z])`, 'u').test(line)

test.describe.serial('the raven player log', () => {
  let clips: Clips = { folder: '', first: '', second: '' }
  let tracks = { folder: '', path: '' }

  test.beforeAll(async () => {
    const [made, track] = await Promise.all([makeClips(), makeTrackClip()])
    clips = made
    tracks = track
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(clips.folder), removeDir(tracks.folder)])
  })

  test('writes the launch, the engine and the budget marks to its log', async () => {
    const userData = await freshUserData()
    try {
      await withApp({
        userData,
        run: async ({ app, page }) => {
          await expect(homeHeading(page)).toBeVisible()
          // The engine opens beside the window; the open comes after it, as a person's would.
          await expectLogged({ userData, text: 'video engine ready: ' })
          await openFile({ app, path: clips.first })
          await expect(page.getByRole('heading', { name: 'Clip 01', exact: true })).toBeVisible()
          await expect(page.locator('html')).toHaveAttribute('data-surface', 'native')
          await expectButton({ page, name: 'Pause (k)' })
          await expectLogged({ userData, text: 'raven-first-frame-ms ' })
        },
      })

      const lines = await readLog({ userData })
      const at = (text: string) => indexOf({ lines, text })
      const launch = at('launch raven player ')
      expect(launch).toBe(0)
      expect(lines[launch] ?? '').toContain('(unpackaged)')
      const engine = at('video engine ready: mpv v0.')
      const launchMark = at('raven-launch-ms')
      const opened = at('open file .mp4')
      const firstFrame = at('raven-first-frame-ms')
      const quit = at('raven-quit-ms')
      // The window's launch mark and the engine both follow the launch, in either order.
      expect(engine).toBeGreaterThan(launch)
      expect(launchMark).toBeGreaterThan(launch)
      expect(opened).toBeGreaterThan(Math.max(engine, launchMark))
      expect(firstFrame).toBeGreaterThan(opened)
      expect(quit).toBeGreaterThan(firstFrame)

      const names = [clips.folder, basename(clips.folder), basename(clips.first), 'Clip 01']
      expect(lines.filter((line) => names.some((name) => line.includes(name)))).toEqual([])

      const file = logPathFor({ userData })
      expect((await stat(dirname(file))).mode & 0o777).toBe(0o700)
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    } finally {
      await removeDir(userData)
    }
  })

  test('never writes a cookie', async () => {
    const userData = await freshUserData()
    const fixture: FixtureServer = await startFixtureServer({
      clips: { first: clips.first, second: clips.second, tracks: tracks.path },
      mode: { pin: PIN, isLocked: true, admin: { kind: FIXTURE_ADMIN_KINDS.off } },
    })
    try {
      await withApp({
        userData,
        run: async ({ app, page }) => {
          await expect(homeHeading(page)).toBeVisible()
          await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
          await openUrl({
            app,
            url: playLinkFor({
              origin: fixture.origin,
              mediaId: FIXTURE_MEDIA.first,
              at: 0,
              next: [],
            }),
          })
          const dialog = page.getByRole('dialog', { name: 'Locked library' })
          await expect(dialog).toBeVisible()
          await dialog.getByLabel('PIN', { exact: true }).fill(PIN)
          await dialog.getByRole('button', { name: 'Unlock' }).click()
          await expect(
            page.getByRole('heading', { name: 'Fixture One', exact: true }),
          ).toBeVisible()
          await expectButton({ page, name: 'Pause (k)' })
          await expect.poll(() => clockOf(page)).toBeGreaterThanOrEqual(PLAY_SECONDS)
        },
      })

      const lines = await readLog({ userData })
      const host = new URL(fixture.origin).host
      expect(lines.some((line) => line.includes(`open server title 1 on ${host}`))).toBe(true)
      const issued = fixture.issued()
      expect(issued.length, 'the fixture issued no cookie to look for').toBeGreaterThan(0)
      const secrets = [...issued, PIN]
      const isLeaked = lines
        .filter((line) => !MARK_ENTRY.test(line))
        .some((line) => secrets.some((secret) => holdsSecret({ line, secret })))
      expect(isLeaked, 'the log holds a cookie value or the PIN').toBe(false)
    } finally {
      await fixture.close().finally(() => removeDir(userData))
    }
  })

  test('keeps every sign-in secret out of its log through a sign in, refreshes, a relayed play, a download and a sign out', async () => {
    const userData = await freshUserData()
    const fixture: FixtureServer = await startFixtureServer({
      clips: { first: clips.first, second: clips.second, tracks: tracks.path },
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
      const printed = await withApp({
        userData,
        run: async ({ app, page, output }) => {
          await expect(homeHeading(page)).toBeVisible()
          await stubTrustPrompt({ app, answer: TRUST_ANSWERS.add })
          const added = await requestFromPage({
            page,
            request: { type: DESKTOP_REQUESTS.addServer, origin: fixture.origin },
          })
          const [serverId = ''] =
            added !== null && added.type === DESKTOP_REPLIES.servers
              ? added.servers.map((server) => server.serverId)
              : []
          const signedIn = await requestFromPage({
            page,
            request: {
              type: DESKTOP_REQUESTS.signIn,
              serverId,
              email: FIXTURE_ACCOUNT.email,
              password: FIXTURE_ACCOUNT.password,
            },
          })
          expect(
            signedIn !== null && signedIn.type === DESKTOP_REPLIES.account
              ? signedIn.account.state
              : null,
          ).toBe(ACCOUNT_STATES.approved)

          const { size } = await stat(tracks.path)
          fixture.throttle({ byte: Math.floor(size * THROTTLE_SHARE) })
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
          await expectButton({ page, name: 'Pause (k)' })
          await page.keyboard.press('k')
          await expectButton({ page, name: 'Play (k)' })
          await SEEK_KEYS.reduce(async (previous, key) => {
            await previous
            await delay(TICKET_MS * 2)
            await page.keyboard.press(key)
            await expect
              .poll(async () => Math.abs((await clockOf(page)) - Number(key) * SECONDS_PER_KEY))
              .toBeLessThanOrEqual(SEEK_SLACK_S)
          }, Promise.resolve())
          fixture.throttle({ byte: null })

          await page.keyboard.press('Escape')
          await expect(homeHeading(page)).toBeVisible()
          const downloading = fixture.requests.length
          await openUrl({
            app,
            url: downloadLinkFor({
              origin: fixture.origin,
              target: { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: FIXTURE_MEDIA.first },
            }),
          })
          const ask = page.getByRole('dialog', { name: 'Download to raven player' })
          await expect(ask).toContainText('Download Fixture One')
          await ask.getByRole('button', { name: 'Download', exact: true }).click()
          await page.getByRole('button', { name: /^Downloads/u }).click()
          await expect(page.getByRole('button', { name: 'Play Fixture One' })).toBeVisible({
            timeout: DOWNLOAD_WAIT_MS,
          })
          const fetched = fixture.requests
            .slice(downloading)
            .filter(
              ({ method, path }) =>
                method === SERVER_METHODS.get && path === MEDIA_PATHS.file(FIXTURE_MEDIA.first),
            )
          expect(fetched.length).toBeGreaterThan(0)
          expect(fetched.every(isRelayed)).toBe(true)

          const signedOut = await requestFromPage({
            page,
            request: { type: DESKTOP_REQUESTS.signOut, serverId },
          })
          expect(
            signedOut !== null && signedOut.type === DESKTOP_REPLIES.account
              ? signedOut.account.state
              : null,
          ).toBe(ACCOUNT_STATES.signedOut)
          return output
        },
      })

      const lines = await readLog({ userData })
      const host = new URL(fixture.origin).host
      expect(lines.some((line) => line.includes(`signed in to ${host}`))).toBe(true)
      expect(lines.some((line) => line.includes(`open server title 1 on ${host}`))).toBe(true)
      expect(lines.some((line) => line.includes(`signed out of ${host}`))).toBe(true)
      // auth-js refreshed the session, so a rotated refresh token and a new JWT are among them.
      expect(
        fixture.requests.some(
          ({ method, path }) =>
            method === SERVER_METHODS.post &&
            path === `${AUTH_V1.token}?${GRANT_PARAM}=${GRANTS.refresh}`,
        ),
      ).toBe(true)
      const issued = fixture.issuedTokens()
      // A session at sign in and at each refresh, a ticket for the play, each seek and the download.
      expect(issued.length).toBeGreaterThan(SEEK_KEYS.length + 3)
      const secrets = [FIXTURE_ACCOUNT.password, FIXTURE_ACCOUNT.email, ...issued]
      const written = [...lines, ...printed.lines().filter((line) => !isMarkLine(line))]
      const isLeaked = written.some(
        (line) =>
          secrets.some((secret) => line.includes(secret)) ||
          SECRET_SHAPES.some((shape) => shape.test(line)),
      )
      expect(isLeaked, 'the log or the output holds a sign-in secret').toBe(false)
    } finally {
      await fixture.close().finally(() => removeDir(userData))
    }
  })

  test('keeps the folder and file name of a file mpv cannot open out of its log', async () => {
    const userData = await freshUserData()
    const own = await makeClips()
    // Granted, since a stat needs no read access, and then refused to mpv's open.
    const broken = join(own.folder, 'Broken Secret.mp4')
    await writeFile(broken, 'not a video at all')
    await chmod(broken, 0o000)
    try {
      await withApp({
        userData,
        run: async ({ app, page }) => {
          await expect(homeHeading(page)).toBeVisible()
          await expectLogged({ userData, text: 'video engine ready: ' })
          // mpv names the file it cannot read in its own warnings.
          await openFile({ app, path: broken })
          await expectLogged({ userData, text: 'mpv could not open the file' })
        },
      })

      const lines = await readLog({ userData })
      expect(lines.some((line) => line.includes('<file>'))).toBe(true)
      const names = [own.folder, basename(own.folder), 'Broken Secret']
      expect(lines.filter((line) => names.some((name) => line.includes(name)))).toEqual([])
    } finally {
      await Promise.all([removeDir(userData), removeDir(own.folder)])
    }
  })
})
