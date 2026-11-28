import { stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { playLinkFor } from '@raven/core'
import { type Clips, makeClips, makeTrackClip } from '@/e2e/clips'
import { FIXTURE_ACCOUNT } from '@/e2e/fixtureAuth'
import { FIXTURE_MEDIA, FIXTURE_MOVIE_NAMES } from '@/e2e/fixtureLibrary'
import { containerOf, type FixtureServer, startWebFixture } from '@/e2e/fixtureServer'
import {
  expectOffline,
  freshUserData,
  heading,
  logPathFor,
  openUrl,
  readLog,
  removeDir,
  serverEnv,
  signIn,
  withApp,
} from '@/e2e/harness'
import { E2E_SYSTEM, makeTempDir } from '@/e2e/platform'
import { clockOf, expectButton, expectNative } from '@/e2e/playerView'
import { playDownload, seedDownloads } from '@/e2e/seedDownloads'
import { entryDirFor, mediaPathFor } from '@/main/downloads/space'

// What the fixture's title plays for before the app quits.
const PLAY_SECONDS = 3
// The seeded downloads' titles and the one media id each test files its own under.
const LABELS = { clip: 'Clip 01', broken: 'Broken Secret' } as const
const MEDIA_ID = 1

type ExpectOwnerOnlyProps = { file: string }

/** The log and its folder are the owner's alone, where the system has modes to say so. */
const expectOwnerOnly = async ({ file }: ExpectOwnerOnlyProps): Promise<void> => {
  if (!E2E_SYSTEM.hasFileModes) return
  expect((await stat(dirname(file))).mode & 0o777).toBe(0o700)
  expect((await stat(file)).mode & 0o777).toBe(0o600)
}

type ExpectLoggedProps = { userData: string; text: string }

/** Waits until a line of the log holds `text`, which main writes a moment after it happens. */
const expectLogged = async ({ userData, text }: ExpectLoggedProps) => {
  await expect
    .poll(async () => (await readLog({ userData })).some((line) => line.includes(text)))
    .toBe(true)
}

type IndexOfProps = { lines: readonly string[]; text: string }

/** Where the first line holding `text` sits in the log, or -1. */
const indexOf = ({ lines, text }: IndexOfProps) => lines.findIndex((line) => line.includes(text))

// A budget mark as the log holds it: a stamp, its level, then only a name and a number.
const MARK_ENTRY = /^\S+ info raven-[a-z][a-z0-9-]* \d+$/

const ESCAPED = /[.*+?^${}()|[\]\\]/gu

type HoldsSecretProps = { line: string; secret: string }

/** Whether `line` holds `secret` as a whole word, so a PIN does not match inside a longer number. */
const holdsSecret = ({ line, secret }: HoldsSecretProps): boolean =>
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
      const { serverId } = await seedDownloads({
        userData,
        clips: [{ path: clips.first, label: LABELS.clip, mediaId: MEDIA_ID }],
      })
      await withApp({
        userData,
        run: async ({ page }) => {
          await expectOffline({ page })
          // The engine opens beside the window; the play comes after it, as a person's would.
          await expectLogged({ userData, text: 'video engine ready: ' })
          await playDownload({ page, label: LABELS.clip })
          await expect(heading({ page, name: LABELS.clip })).toBeVisible()
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

      // Neither where the clip came from, nor where the download sits, nor its title.
      const names = [
        clips.folder,
        basename(clips.folder),
        basename(clips.first),
        entryDirFor({ userData, serverId, mediaId: MEDIA_ID }),
        serverId,
        LABELS.clip,
      ]
      expect(lines.filter((line) => names.some((name) => line.includes(name)))).toEqual([])

      await expectOwnerOnly({ file: logPathFor({ userData }) })
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

  test('keeps the folder and file name of a download mpv cannot open out of its log', async () => {
    const userData = await freshUserData()
    const folder = await makeTempDir('raven-e2e-broken-')
    const source = join(folder, `${LABELS.broken}.mp4`)
    try {
      await writeFile(source, 'not a video at all')
      const { serverId } = await seedDownloads({
        userData,
        clips: [{ path: source, label: LABELS.broken, mediaId: MEDIA_ID }],
      })
      const container = containerOf(source)
      const video = mediaPathFor({ userData, serverId, mediaId: MEDIA_ID, container })
      // Granted, since a stat needs no read access, and then refused to mpv's open.
      await E2E_SYSTEM.denyReading(video)
      await withApp({
        userData,
        run: async ({ page }) => {
          await expectOffline({ page })
          await expectLogged({ userData, text: 'video engine ready: ' })
          // mpv names the file it cannot read in its own warnings.
          await playDownload({ page, label: LABELS.broken })
          await expectLogged({ userData, text: 'mpv could not open the file' })
        },
      })

      const lines = await readLog({ userData })
      const isFileBlanked = lines.some((line) => line.includes('<file>'))
      expect(isFileBlanked || !E2E_SYSTEM.isRefusedFileNamed).toBe(true)
      const names = [
        entryDirFor({ userData, serverId, mediaId: MEDIA_ID }),
        serverId,
        basename(video),
        folder,
        basename(folder),
        LABELS.broken,
      ]
      expect(lines.filter((line) => names.some((name) => line.includes(name)))).toEqual([])
    } finally {
      await Promise.all([removeDir(userData), removeDir(folder)])
    }
  })
})
