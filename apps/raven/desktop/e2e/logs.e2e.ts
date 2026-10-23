import { chmod, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { playLinkFor } from '@raven/core'
import { type Clips, makeClips, makeTrackClip } from '@/e2e/clips'
import { FIXTURE_ACCOUNT } from '@/e2e/fixtureAuth'
import { FIXTURE_MEDIA, FIXTURE_MOVIE_NAMES } from '@/e2e/fixtureLibrary'
import { type FixtureServer, startWebFixture } from '@/e2e/fixtureServer'
import {
  expectOffline,
  freshUserData,
  heading,
  logPathFor,
  openFile,
  openUrl,
  readLog,
  removeDir,
  serverEnv,
  signIn,
  withApp,
} from '@/e2e/harness'
import { clockOf, expectButton, expectNative } from '@/e2e/playerView'

// What the fixture's title plays for before the app quits.
const PLAY_SECONDS = 3

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

test.describe.serial('the Raven log', () => {
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
          await expectOffline({ page })
          // The engine opens beside the window; the open comes after it, as a person's would.
          await expectLogged({ userData, text: 'video engine ready: ' })
          await openFile({ app, path: clips.first })
          await expect(heading({ page, name: 'Clip 01' })).toBeVisible()
          await expectNative(page)
          await expectButton({ page, name: 'Pause (k)' })
          await expectLogged({ userData, text: 'raven-first-frame-ms ' })
        },
      })

      const lines = await readLog({ userData })
      const at = (text: string) => indexOf({ lines, text })
      const launch = at('launch Raven ')
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

  test('never writes a token, a ticket, the password or the email', async () => {
    const userData = await freshUserData()
    const fixture: FixtureServer = await startWebFixture({
      clips: { first: clips.first, second: clips.second, tracks: tracks.path },
    })
    try {
      await withApp({
        userData,
        env: serverEnv({ origin: fixture.origin }),
        run: async ({ app, page }) => {
          await signIn({ page })
          // A link from outside, as the browser hands one over, so main opens the title too.
          await openUrl({
            app,
            url: playLinkFor({
              origin: fixture.origin,
              mediaId: FIXTURE_MEDIA.first,
              at: 0,
              next: [],
            }),
          })
          await expect(heading({ page, name: FIXTURE_MOVIE_NAMES.first })).toBeVisible()
          await expectNative(page)
          await expectButton({ page, name: 'Pause (k)' })
          await expect
            .poll(async () => (await clockOf(page)) ?? 0)
            .toBeGreaterThanOrEqual(PLAY_SECONDS)
        },
      })

      const lines = await readLog({ userData })
      expect(lines.some((line) => line.includes(`open server title ${FIXTURE_MEDIA.first}`))).toBe(
        true,
      )
      const issued = fixture.issuedTokens()
      expect(issued.length, 'the fixture issued no token to look for').toBeGreaterThan(0)
      const secrets = [...issued, FIXTURE_ACCOUNT.password, FIXTURE_ACCOUNT.email]
      const isLeaked = lines
        .filter((line) => !MARK_ENTRY.test(line))
        .some((line) => secrets.some((secret) => holdsSecret({ line, secret })))
      expect(isLeaked, 'the log holds a token, a ticket, the password or the email').toBe(false)
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
          await expectOffline({ page })
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
