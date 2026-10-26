import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import {
  DEFAULT_OUTPUT_SETTINGS,
  DOWNLOAD_KINDS,
  DOWNLOAD_STATUS_KINDS,
  DOWNLOAD_TARGET_KINDS,
  downloadLinkFor,
  formatBytes,
  SERVER_METHODS,
} from '@raven/core'
import { makeClips, makeTrackClip } from '@/e2e/clips'
import { ACCOUNT_TICKET_PREFIX, FIXTURE_ACCOUNT } from '@/e2e/fixtureAuth'
import { FIXTURE_MEDIA, FIXTURE_MOVIE_NAMES, FIXTURE_TITLES } from '@/e2e/fixtureLibrary'
import {
  containerOf,
  type FixtureRequest,
  type FixtureServer,
  isTicketOnly,
  MEDIA_PATHS,
  routesOf,
  startWebFixture,
} from '@/e2e/fixtureServer'
import {
  expectOffline,
  freshUserData,
  heading,
  openUrl,
  readLog,
  removeDir,
  serverEnv,
  sideLink,
  signIn,
  withApp,
} from '@/e2e/harness'
import { expectButton, expectClockAdvancing, expectPlayingNatively } from '@/e2e/playerView'
import {
  CONFIG_FILE,
  DEFAULT_UPDATE_SETTINGS,
  type DesktopConfig,
  isDesktopConfig,
} from '@/main/desktopConfig'
import {
  DOWNLOADS_FILE,
  type DownloadsState,
  isDownloadsState,
} from '@/main/downloads/downloadState'
import { entryDirFor, partPathFor, videoPathFor } from '@/main/downloads/space'

// Past the file's first chunk, so a pause finds bytes on disk to resume from.
const THROTTLE_BYTE = 262_144
// The test hook's sync retry, in place of the spec's five minutes.
const SYNC_RETRY_HOOK_MS = '2000'
// A download is a local copy of a small clip, though the origin's probe may wait its 2 s.
const READY_WAIT_MS = 15_000
// The page asks again every 5 s while its server is down, then signs main in, which sends.
const LATE_REPORT_WAIT_MS = 30_000
// The notice stays 6 s, and a launch deletion tells of itself once the page says ready.
const NOTICE_WAIT_MS = 10_000
const MINUTE_MS = 60_000
// What a download played offline owes its server: the play, then where it stopped.
const PLAYED = {
  method: SERVER_METHODS.post,
  path: MEDIA_PATHS.plays(FIXTURE_MEDIA.first),
} as const
const SAVED = {
  method: SERVER_METHODS.put,
  path: MEDIA_PATHS.progress(FIXTURE_MEDIA.first),
} as const
// A launch with the server down, then the wait for it to come back and hear the play.
const OFFLINE_TEST_MS = 120_000

type FixtureClips = { first: string; second: string; tracks: string }

// The clips every fixture in this file serves, their sizes by media id, and the folders to remove after.
let fixtureClips: FixtureClips = { first: '', second: '', tracks: '' }
let clipSizes: ReadonlyMap<number, number> = new Map()
let clipFolders: string[] = []

const sizeOfFile = async (path: string) => (await stat(path)).size

test.beforeAll(async () => {
  const [clips, track] = await Promise.all([makeClips(), makeTrackClip()])
  fixtureClips = { first: clips.first, second: clips.second, tracks: track.path }
  clipFolders = [clips.folder, track.folder]
  const [tracksSize, firstSize, secondSize] = await Promise.all([
    sizeOfFile(track.path),
    sizeOfFile(clips.first),
    sizeOfFile(clips.second),
  ])
  clipSizes = new Map([
    [FIXTURE_MEDIA.first, tracksSize],
    [FIXTURE_MEDIA.second, secondSize],
    [FIXTURE_MEDIA.firstEpisode, firstSize],
    [FIXTURE_MEDIA.secondEpisode, secondSize],
  ])
})

test.afterAll(async () => {
  await Promise.all(clipFolders.map((dir) => removeDir(dir)))
})

/** The bytes the fixture serves for a title, which it reports as the title's size. */
const sizeOf = (mediaId: number): number => {
  const size = clipSizes.get(mediaId)
  if (size === undefined) throw new Error(`The fixture serves no clip for media ${mediaId}.`)
  return size
}

/** A server with accounts, whose media origin serves a title's file for its account ticket. */
const startAccountsFixture = () => startWebFixture({ clips: fixtureClips, hasMediaPlane: true })

type RequestsToProps = {
  requests: readonly FixtureRequest[]
  method: string
  path: string
}

const requestsTo = ({ requests, method, path }: RequestsToProps) =>
  requests.filter((request) => request.method === method && request.path === path)

type FileFetchesProps = {
  requests: readonly FixtureRequest[]
  mediaId: number
}

/** Every fetch of a title's file a listener heard, its ticket already left out of the path. */
const fileFetches = ({ requests, mediaId }: FileFetchesProps) =>
  requestsTo({ requests, method: SERVER_METHODS.get, path: MEDIA_PATHS.file(mediaId) })

/** A body read as JSON, or null; never an error, which would print the body. */
const parseJson = (text: string | null): unknown => {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return null
  }
}

/** The position a `PUT progress` carried, or null when it carried none. */
const positionOf = ({ body }: FixtureRequest): number | null => {
  const value = parseJson(body)
  if (typeof value !== 'object' || value === null || !('position' in value)) return null
  return typeof value.position === 'number' ? value.position : null
}

/** A path's size on disk, 0 while there is nothing there. */
const sizeOnDisk = (path: string): Promise<number> =>
  stat(path).then(
    ({ size }) => size,
    () => 0,
  )

const isPresent = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

type StoredDownloadsProps = { userData: string }

/** `downloads.json` as main left it, narrowed by the guard main reads it with. */
const storedDownloads = async ({ userData }: StoredDownloadsProps): Promise<DownloadsState> => {
  const value = parseJson(await readFile(join(userData, DOWNLOADS_FILE), 'utf8'))
  if (!isDownloadsState(value)) throw new Error('downloads.json is not what Raven keeps.')
  return value
}

const askDialog = (page: Page) => page.getByRole('dialog', { name: 'Download to Raven' })

type ConfirmDownloadProps = { page: Page; question: string }

/** Answers the download dialog once its question names what `question` says. */
const confirmDownload = async ({ page, question }: ConfirmDownloadProps) => {
  const ask = askDialog(page)
  await expect(ask).toContainText(question)
  await ask.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(ask).toHaveCount(0)
}

type DownloadFromPageProps = { page: Page; question: string }

/** Download on the title page that is open, then the dialog's Download. */
const downloadFromPage = async ({ page, question }: DownloadFromPageProps) => {
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  await confirmDownload({ page, question })
}

type DownloadsLinkProps = { page: Page; count: number }

/** The side menu's Downloads, whose name carries the count its badge shows. */
const downloadsLink = ({ page, count }: DownloadsLinkProps) =>
  sideLink({ page, name: count === 0 ? 'Downloads' : `Downloads (${count} in progress)` })

type OpenDownloadsProps = { page: Page }

const openDownloads = async ({ page }: OpenDownloadsProps) => {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Downloads/u })
    .click()
  await expect(heading({ page, name: 'Downloads' })).toBeVisible()
}

type OpenTitleProps = { page: Page; title: string }

/** A title's page, from its card on Home. */
const openTitle = async ({ page, title }: OpenTitleProps) => {
  await sideLink({ page, name: 'Home' }).click()
  await page.getByRole('link', { name: title, exact: true }).click()
  await expect(heading({ page, name: title })).toBeVisible()
}

type RowOfProps = { page: Page; label: string }

/** A download's own row: the innermost item naming it, inside its title's group. */
const rowOf = ({ page, label }: RowOfProps) =>
  page.getByRole('listitem').filter({ hasText: label, hasNot: page.getByRole('listitem') })

type ExpectReadyProps = { page: Page; label: string; size: number }

/** The row reads ready: it offers Play, and names the whole file's size. */
const expectReady = async ({ page, label, size }: ExpectReadyProps) => {
  const row = rowOf({ page, label })
  await expect(row.getByRole('button', { name: `Play ${label}` })).toBeVisible({
    timeout: READY_WAIT_MS,
  })
  await expect(row.getByText(formatBytes(size), { exact: true })).toBeVisible()
}

type ServerIdOfProps = { userData: string }

/** The id Raven files its server's downloads under, as its config holds it. */
const serverIdOf = async ({ userData }: ServerIdOfProps): Promise<string> => {
  const config = parseJson(await readFile(join(userData, CONFIG_FILE), 'utf8'))
  if (!isDesktopConfig(config)) throw new Error('Raven saved no config.')
  return config.server.id
}

test.describe.serial('downloading from the web pages, and playing offline', () => {
  let userData = ''
  let started: FixtureServer | null = null

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    started = await startAccountsFixture()
  })

  test.afterAll(async () => {
    const closing = started === null ? Promise.resolve() : started.close()
    await closing.finally(() => removeDir(userData))
  })

  test('downloads a movie from its page, fetching it from the media origin on an account ticket', async () => {
    const fixture = server()
    const size = sizeOf(FIXTURE_MEDIA.first)
    const { serverId, output: printed } = await withApp({
      userData,
      env: serverEnv({ origin: fixture.origin }),
      run: async ({ page, output }) => {
        await signIn({ page })
        await openTitle({ page, title: FIXTURE_TITLES.first })
        await downloadFromPage({
          page,
          question: `Download ${FIXTURE_MOVIE_NAMES.first} (1 movie, ${formatBytes(size)})?`,
        })
        await openDownloads({ page })
        await expectReady({ page, label: FIXTURE_MOVIE_NAMES.first, size })
        return { serverId: await serverIdOf({ userData }), output }
      },
    })

    const files = fileFetches({
      requests: fixture.elsewhere.requests,
      mediaId: FIXTURE_MEDIA.first,
    })
    expect(files.length).toBeGreaterThan(0)
    expect(files.every(isTicketOnly)).toBe(true)
    const sidecars = requestsTo({
      requests: fixture.elsewhere.requests,
      method: SERVER_METHODS.get,
      path: MEDIA_PATHS.sidecar(FIXTURE_MEDIA.first),
    })
    expect(sidecars.length).toBeGreaterThan(0)
    expect(sidecars.every(isTicketOnly)).toBe(true)
    // The ticket came from the server itself, for the page's account; the file never did.
    const mints = requestsTo({
      requests: fixture.requests,
      method: SERVER_METHODS.post,
      path: MEDIA_PATHS.accountTicket(FIXTURE_MEDIA.first),
    })
    expect(mints.length).toBeGreaterThan(0)
    expect(mints.every(({ hasBearer }) => hasBearer)).toBe(true)
    expect(fileFetches({ requests: fixture.requests, mediaId: FIXTURE_MEDIA.first })).toEqual([])
    // A ticket rides in the file's address alone: main never prints, logs or keeps one.
    const tickets = fixture
      .issuedTokens()
      .filter((token) => token.startsWith(ACCOUNT_TICKET_PREFIX))
    expect(tickets.length).toBeGreaterThan(0)
    const isNamed = (text: string) => tickets.some((ticket) => text.includes(ticket))
    expect(printed.lines().filter(isNamed)).toEqual([])
    expect((await readLog({ userData })).filter(isNamed)).toEqual([])
    expect(isNamed(await readFile(join(userData, DOWNLOADS_FILE), 'utf8'))).toBe(false)

    const stored = await storedDownloads({ userData })
    expect(
      stored.entries.map(({ mediaId, label, status, size: bytes }) => ({
        mediaId,
        label,
        status,
        size: bytes,
      })),
    ).toEqual([
      {
        mediaId: FIXTURE_MEDIA.first,
        label: FIXTURE_MOVIE_NAMES.first,
        status: { kind: DOWNLOAD_STATUS_KINDS.ready },
        size,
      },
    ])
    const video = videoPathFor({
      userData,
      serverId,
      mediaId: FIXTURE_MEDIA.first,
      container: containerOf(fixtureClips.tracks),
    })
    expect(await sizeOnDisk(video)).toBe(size)
  })

  test('downloads a season from its page, and the side menu counts what is left', async () => {
    const fixture = server()
    const bytes = sizeOf(FIXTURE_MEDIA.firstEpisode) + sizeOf(FIXTURE_MEDIA.secondEpisode)
    // Each file is held until the test lets it go, so the count steps down one at a time.
    const releaseFirst = fixture.stall({ path: /^\/api\/media\/5\/file/u })
    const releaseSecond = fixture.stall({ path: /^\/api\/media\/6\/file/u })
    try {
      await withApp({
        userData,
        env: serverEnv({ origin: fixture.origin }),
        run: async ({ page }) => {
          await expect(heading({ page, name: 'Home' })).toBeVisible()
          await openTitle({ page, title: FIXTURE_TITLES.show })
          await page
            .getByRole('link', { name: new RegExp(`^${FIXTURE_TITLES.season}`, 'u') })
            .click()
          await expect(heading({ page, name: FIXTURE_TITLES.season })).toBeVisible()
          await downloadFromPage({ page, question: `(2 episodes, ${formatBytes(bytes)})` })
          await expect(downloadsLink({ page, count: 2 })).toBeVisible()
          releaseFirst()
          await expect(downloadsLink({ page, count: 1 })).toBeVisible({ timeout: READY_WAIT_MS })
          releaseSecond()
          await expect(downloadsLink({ page, count: 0 })).toBeVisible({ timeout: READY_WAIT_MS })
          await openDownloads({ page })
          await expect(page.getByRole('button', { name: /^Play /u })).toHaveCount(3)
        },
      })
    } finally {
      releaseFirst()
      releaseSecond()
    }
  })

  test('takes a raven://download link from outside, and resumes a paused download with a Range', async () => {
    const fixture = server()
    const label = FIXTURE_MOVIE_NAMES.second
    const size = sizeOf(FIXTURE_MEDIA.second)
    await withApp({
      userData,
      env: serverEnv({ origin: fixture.origin }),
      run: async ({ app, page }) => {
        await expect(heading({ page, name: 'Home' })).toBeVisible()
        const part = partPathFor({
          userData,
          serverId: await serverIdOf({ userData }),
          mediaId: FIXTURE_MEDIA.second,
          container: containerOf(fixtureClips.second),
        })
        fixture.throttle({ byte: THROTTLE_BYTE })
        await openUrl({
          app,
          url: downloadLinkFor({
            origin: fixture.origin,
            target: { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: FIXTURE_MEDIA.second },
          }),
        })
        await confirmDownload({
          page,
          question: `Download ${label} (1 movie, ${formatBytes(size)})`,
        })
        await openDownloads({ page })
        const row = rowOf({ page, label })
        await expect(row.getByRole('button', { name: `Pause ${label}` })).toBeVisible()
        // The pause must find bytes on disk, or the resume would start over with no Range.
        await expect.poll(() => sizeOnDisk(part)).toBeGreaterThan(0)
        await row.getByRole('button', { name: `Pause ${label}` }).click()
        await expect(row.getByRole('button', { name: `Resume ${label}` })).toBeVisible()
        const from = fileFetches({
          requests: fixture.elsewhere.requests,
          mediaId: FIXTURE_MEDIA.second,
        }).length
        expect(from).toBeGreaterThan(0)

        fixture.throttle({ byte: null })
        await row.getByRole('button', { name: `Resume ${label}` }).click()
        await expectReady({ page, label, size })
        const [resumed] = fileFetches({
          requests: fixture.elsewhere.requests,
          mediaId: FIXTURE_MEDIA.second,
        }).slice(from)
        expect(resumed?.range ?? '').toMatch(/^bytes=[1-9]\d*-$/u)
        expect(resumed === undefined ? false : isTicketOnly(resumed)).toBe(true)
      },
    })
  })

  test('deletes a download, its row and its folder', async () => {
    const fixture = server()
    const label = FIXTURE_MOVIE_NAMES.second
    const size = sizeOf(FIXTURE_MEDIA.second)
    await withApp({
      userData,
      env: serverEnv({ origin: fixture.origin }),
      run: async ({ page }) => {
        await expect(heading({ page, name: 'Home' })).toBeVisible()
        const folder = entryDirFor({
          userData,
          serverId: await serverIdOf({ userData }),
          mediaId: FIXTURE_MEDIA.second,
        })
        expect(await isPresent(folder)).toBe(true)
        await openDownloads({ page })
        const row = rowOf({ page, label })
        await row.getByRole('button', { name: `Delete ${label}` }).click()
        await expect(row).toContainText(`Delete ${label}? ${formatBytes(size)} will be freed.`)
        await row.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(rowOf({ page, label })).toHaveCount(0)
        await expect.poll(() => isPresent(folder)).toBe(false)
        await expect(rowOf({ page, label: FIXTURE_MOVIE_NAMES.first })).toHaveCount(1)
      },
    })
  })

  test('plays a download after a relaunch with the server down, and sends its position once the server is back', async () => {
    test.setTimeout(OFFLINE_TEST_MS)
    const fixture = server()
    const label = FIXTURE_MOVIE_NAMES.first
    await fixture.close()
    const heardBefore = fixture.requests.length
    await withApp({
      userData,
      env: {
        ...serverEnv({ origin: fixture.origin }),
        RAVEN_DESKTOP_SYNC_RETRY_MS: SYNC_RETRY_HOOK_MS,
      },
      run: async ({ page }) => {
        await expectOffline({ page })
        await rowOf({ page, label })
          .getByRole('button', { name: `Play ${label}` })
          .click()
        await expectPlayingNatively({ page, title: label })
        // Paused, so the position main keeps for the server stays put. With no server the page
        // has not signed main in, so the play is kept for the account last signed in.
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Play (k)' })
        const owedOf = async () =>
          (await storedDownloads({ userData })).owed.find(
            ({ mediaId }) => mediaId === FIXTURE_MEDIA.first,
          )?.pending ?? null
        await expect
          .poll(async () => {
            const owed = await owedOf()
            return owed === null ? null : { play: owed.play, accountId: owed.accountId }
          })
          .toEqual({ play: true, accountId: FIXTURE_ACCOUNT.id })

        // The server comes back as it was: the page finds it, signs main in again, and main sends.
        await fixture.reopen()
        type HeardProps = { method: string; path: string }

        const heard = (route: HeardProps) =>
          requestsTo({ requests: fixture.requests.slice(heardBefore), ...route })
        await expect
          .poll(() => heard(PLAYED).length > 0 && heard(SAVED).length > 0, {
            timeout: LATE_REPORT_WAIT_MS,
          })
          .toBe(true)
        const routes = routesOf(fixture.requests.slice(heardBefore))
        // The play goes first, so the server hears it before a position that may mark it watched.
        expect(routes.indexOf(`${PLAYED.method} ${PLAYED.path}`)).toBeLessThan(
          routes.indexOf(`${SAVED.method} ${SAVED.path}`),
        )
        const [saved] = heard(SAVED)
        expect(saved?.hasBearer ?? false).toBe(true)
        expect(saved === undefined ? null : positionOf(saved)).toBeGreaterThan(0)
        // The player stayed put through the server's return: still paused, it plays on from there.
        await expectButton({ page, name: 'Play (k)' })
        await page.keyboard.press('k')
        await expectClockAdvancing(page)
      },
    })
  })
})

test('deletes at launch a download watched eleven minutes ago, and says so', async () => {
  const userData = await freshUserData()
  const fixture = await startAccountsFixture()
  const serverId = randomUUID()
  const at = Date.now()
  const container = containerOf(fixtureClips.tracks)
  const config: DesktopConfig = {
    version: 5,
    output: DEFAULT_OUTPUT_SETTINGS,
    server: { id: serverId, origin: fixture.origin },
    updates: { ...DEFAULT_UPDATE_SETTINGS },
    lastAccountId: null,
  }
  const seeded: DownloadsState = {
    version: 2,
    entries: [
      {
        downloadId: randomUUID(),
        serverId,
        mediaId: FIXTURE_MEDIA.first,
        label: FIXTURE_TITLES.first,
        group: {
          kind: DOWNLOAD_KINDS.movie,
          key: 'movie:1',
          title: FIXTURE_TITLES.first,
          order: 0,
        },
        container,
        size: sizeOf(FIXTURE_MEDIA.first),
        duration: 30,
        watchedPercent: 90,
        sidecars: [],
        status: { kind: DOWNLOAD_STATUS_KINDS.ready },
        autoDelete: true,
        watchedAt: at - 11 * MINUTE_MS,
        serverPosition: 0,
        pending: { play: false, position: null, furthest: null, at: 0, accountId: null },
        createdAt: at - 60 * MINUTE_MS,
      },
    ],
    autoDeleteDefault: false,
    owed: [],
  }
  if (!isDownloadsState(seeded)) throw new Error('The seeded downloads are not what main reads.')
  const folder = entryDirFor({ userData, serverId, mediaId: FIXTURE_MEDIA.first })
  try {
    await mkdir(folder, { recursive: true })
    await copyFile(
      fixtureClips.tracks,
      videoPathFor({ userData, serverId, mediaId: FIXTURE_MEDIA.first, container }),
    )
    await Promise.all([
      writeFile(join(userData, CONFIG_FILE), JSON.stringify(config)),
      writeFile(join(userData, DOWNLOADS_FILE), JSON.stringify(seeded)),
    ])
    await withApp({
      userData,
      env: serverEnv({ origin: fixture.origin }),
      run: async ({ page }) => {
        await expect(page.getByText(`Deleted ${FIXTURE_TITLES.first} after watching`)).toBeVisible({
          timeout: NOTICE_WAIT_MS,
        })
        await expect.poll(() => isPresent(folder)).toBe(false)
      },
    })
    const stored = await storedDownloads({ userData })
    expect(stored.entries).toEqual([])
    expect(stored.owed).toEqual([])
  } finally {
    await fixture.close().finally(() => removeDir(userData))
  }
})
