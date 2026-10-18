import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type DownloadTarget, downloadLinkFor, formatBytes } from '@raven/core'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { makeClips, makeTrackClip } from '@/e2e/clips'
import {
  containerOf,
  FIXTURE_ITEMS,
  FIXTURE_MEDIA,
  type FixtureMode,
  type FixtureRequest,
  type FixtureServer,
  routesOf,
  startFixtureServer,
} from '@/e2e/fixtureServer'
import {
  freshUserData,
  openUrl,
  removeDir,
  requestFromPage,
  stubTrustPrompt,
  withApp,
} from '@/e2e/harness'
import { CONFIG_FILE, type DesktopConfig, EMPTY_CONFIG } from '@/main/desktopConfig'
import {
  DOWNLOADS_FILE,
  type DownloadsState,
  isDownloadsState,
} from '@/main/downloads/downloadState'
import { entryDirFor, partPathFor, videoPathFor } from '@/main/downloads/space'

const PIN = '3001'
const LOCKED: FixtureMode = { pin: PIN, isLocked: true, admin: { kind: 'off' } }
// Past the file's first chunk, so a pause finds bytes on disk to resume from.
const THROTTLE_BYTE = 262_144
// The test hook's sync retry, in place of the spec's five minutes.
const SYNC_RETRY_HOOK_MS = '2000'
// A download is a local copy of a small clip, though the origin's probe may wait its 2 s.
const READY_WAIT_MS = 15_000
// A failed try to report: the launch's own, or the 2 s retry's when the launch's came before
// main's output was read.
const FAILED_TRY_WAIT_MS = 20_000
// The late report waits for a retry or two once the server is back.
const LATE_REPORT_WAIT_MS = 20_000
// The notice stays 6 s, and a launch deletion tells of itself once the page says ready.
const NOTICE_WAIT_MS = 10_000
const MINUTE_MS = 60_000
// What a download played offline owes its server: the play, then where it stopped.
const PLAYED = { method: 'POST', path: '/api/media/1/plays' } as const
const SAVED = { method: 'PUT', path: '/api/media/1/progress' } as const
// Two launches, a hang and a late report.
const OFFLINE_TEST_MS = 120_000

type FixtureClips = { first: string; second: string; tracks: string }

// The clips every fixture in this file serves, their sizes by media id, and the folders to remove after.
let fixtureClips: FixtureClips = { first: '', second: '', tracks: '' }
let clipSizes: ReadonlyMap<number, number> = new Map()
let clipFolders: string[] = []

test.beforeAll(async () => {
  const [clips, track] = await Promise.all([makeClips(), makeTrackClip()])
  fixtureClips = { first: clips.first, second: clips.second, tracks: track.path }
  clipFolders = [clips.folder, track.folder]
  const [firstSize, secondSize] = await Promise.all([stat(track.path), stat(clips.second)])
  clipSizes = new Map([
    [FIXTURE_MEDIA.first, firstSize.size],
    [FIXTURE_MEDIA.second, secondSize.size],
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

const startLockedFixture = ({ mediaPlane }: { mediaPlane: boolean }) =>
  startFixtureServer({ clips: fixtureClips, mode: LOCKED, mediaPlane })

const linkTo = ({ fixture, target }: { fixture: FixtureServer; target: DownloadTarget }) =>
  downloadLinkFor({ origin: fixture.origin, target })

/** The server's name until it is renamed: its origin's host, with the port. */
const hostOf = ({ fixture }: { fixture: FixtureServer }) => new URL(fixture.origin).host

const requestsTo = ({
  requests,
  method,
  path,
}: {
  requests: readonly FixtureRequest[]
  method: string
  path: string
}) => requests.filter((request) => request.method === method && request.path === path)

/** Every fetch of a title's file a listener heard, its ticket already left out of the path. */
const fileFetches = ({
  requests,
  mediaId,
}: {
  requests: readonly FixtureRequest[]
  mediaId: number
}) => requestsTo({ requests, method: 'GET', path: `/api/media/${mediaId}/file` })

/** A request a media origin takes: a ticket and no cookie of any kind. */
const isTicketOnly = ({ hasTicket, hasUnlock, hasAdmin, hasOtherCookie }: FixtureRequest) =>
  hasTicket && !hasUnlock && !hasAdmin && !hasOtherCookie

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

/** `downloads.json` as main left it, narrowed by the guard main reads it with. */
const storedDownloads = async ({ userData }: { userData: string }): Promise<DownloadsState> => {
  const value = parseJson(await readFile(join(userData, DOWNLOADS_FILE), 'utf8'))
  if (!isDownloadsState(value)) throw new Error('downloads.json is not what raven player keeps.')
  return value
}

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
const expectPlayingNatively = async ({ page, title }: { page: Page; title: string }) => {
  await expect(heading({ page, name: title })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'native')
  await expectButton({ page, name: 'Pause (k)' })
  await expectClockMoving(page)
}

const lockedDialog = (page: Page) => page.getByRole('dialog', { name: 'Locked library' })

const askDialog = (page: Page) => page.getByRole('dialog', { name: 'Download to raven player' })

/**
 * Opens a download link and answers its dialog: the PIN first when this launch has not given
 * it yet, then Download once the question names what `question` says.
 */
const download = async ({
  app,
  page,
  fixture,
  target,
  question,
}: {
  app: ElectronApplication
  page: Page
  fixture: FixtureServer
  target: DownloadTarget
  question: string
}) => {
  await openUrl({ app, url: linkTo({ fixture, target }) })
  await expect(lockedDialog(page).or(askDialog(page))).toBeVisible()
  if (await lockedDialog(page).isVisible()) {
    const unlock = lockedDialog(page)
    await unlock.getByLabel('PIN', { exact: true }).fill(PIN)
    await unlock.getByRole('button', { name: 'Unlock' }).click()
  }
  const ask = askDialog(page)
  await expect(ask).toContainText(question)
  await ask.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(ask).toHaveCount(0)
}

/** Home's Downloads button, whose name carries the count its badge shows. */
const downloadsButton = ({ page, count }: { page: Page; count: number }) =>
  page.getByRole('button', {
    name: count === 0 ? 'Downloads' : `Downloads, ${count} in progress`,
    exact: true,
  })

const openDownloads = async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /^Downloads/u }).click()
  await expect(heading({ page, name: 'Downloads' })).toBeVisible()
}

const rowOf = ({ page, label }: { page: Page; label: string }) =>
  page.getByRole('listitem').filter({ hasText: label })

/** The row reads ready: it offers Play, and names the whole file's size. */
const expectReady = async ({ page, label, size }: { page: Page; label: string; size: number }) => {
  const row = rowOf({ page, label })
  await expect(row.getByRole('button', { name: `Play ${label}` })).toBeVisible({
    timeout: READY_WAIT_MS,
  })
  await expect(row.getByText(formatBytes(size), { exact: true })).toBeVisible()
}

const serverIdOf = async ({ page }: { page: Page }): Promise<string> => {
  const reply = await requestFromPage({ page, request: { type: 'listServers' } })
  const [server] = reply !== null && reply.type === 'servers' ? reply.servers : []
  if (server === undefined) throw new Error('raven player keeps no server.')
  return server.serverId
}

test.describe.serial('downloading through a media origin', () => {
  let userData = ''
  let started: FixtureServer | null = null

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    started = await startLockedFixture({ mediaPlane: true })
  })

  test.afterAll(async () => {
    const closing = started === null ? Promise.resolve() : started.close()
    await closing.finally(() => removeDir(userData))
  })

  test('asks before a download link, then fetches the file from the origin with a ticket alone', async () => {
    const fixture = server()
    const size = sizeOf(FIXTURE_MEDIA.first)
    const serverId = await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        await download({
          app,
          page,
          fixture,
          target: { kind: 'media', mediaId: FIXTURE_MEDIA.first },
          question: `Download Fixture One (1 movie, ${formatBytes(size)}) from ${hostOf({ fixture })}?`,
        })
        await openDownloads({ page })
        await expectReady({ page, label: 'Fixture One', size })
        return serverIdOf({ page })
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
      method: 'GET',
      path: '/api/media/1/subtitles/external-0',
    })
    expect(sidecars.length).toBeGreaterThan(0)
    expect(sidecars.every(isTicketOnly)).toBe(true)
    // The ticket came from the server itself, behind the PIN; the file never did.
    const tickets = requestsTo({
      requests: fixture.requests,
      method: 'GET',
      path: '/api/media/1/ticket',
    })
    expect(tickets.length).toBeGreaterThan(0)
    expect(tickets.every(({ hasUnlock }) => hasUnlock)).toBe(true)
    expect(fileFetches({ requests: fixture.requests, mediaId: FIXTURE_MEDIA.first })).toEqual([])

    const stored = await storedDownloads({ userData })
    expect(
      stored.entries.map(({ mediaId, label, status, size: bytes }) => ({
        mediaId,
        label,
        status,
        size: bytes,
      })),
    ).toEqual([
      { mediaId: FIXTURE_MEDIA.first, label: 'Fixture One', status: { kind: 'ready' }, size },
    ])
    const video = videoPathFor({
      userData,
      serverId,
      mediaId: FIXTURE_MEDIA.first,
      container: containerOf(fixtureClips.tracks),
    })
    expect(await sizeOnDisk(video)).toBe(size)
  })

  test('pauses a download partway and resumes it from the bytes on disk with a Range', async () => {
    const fixture = server()
    const label = 'Fixture Two'
    const size = sizeOf(FIXTURE_MEDIA.second)
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        const part = partPathFor({
          userData,
          serverId: await serverIdOf({ page }),
          mediaId: FIXTURE_MEDIA.second,
          container: containerOf(fixtureClips.second),
        })
        fixture.throttle({ byte: THROTTLE_BYTE })
        await download({
          app,
          page,
          fixture,
          target: { kind: 'media', mediaId: FIXTURE_MEDIA.second },
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
    const label = 'Fixture Two'
    const size = sizeOf(FIXTURE_MEDIA.second)
    await withApp({
      userData,
      run: async ({ page }) => {
        await expect(homeHeading(page)).toBeVisible()
        const folder = entryDirFor({
          userData,
          serverId: await serverIdOf({ page }),
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
        await expect(rowOf({ page, label: 'Fixture One' })).toHaveCount(1)
      },
    })
  })

  test('plays a download while its server hangs and once it is gone, and tells it later', async () => {
    test.setTimeout(OFFLINE_TEST_MS)
    const gone = server()
    const port = Number(new URL(gone.origin).port)
    await withApp({
      userData,
      run: async ({ page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await openDownloads({ page })
        // Every request waits from here on: playing must ask nothing of the server.
        gone.hang()
        await rowOf({ page, label: 'Fixture One' })
          .getByRole('button', { name: 'Play Fixture One' })
          .click()
        await expectPlayingNatively({ page, title: 'Fixture One' })
        // A save the server cannot hear, so the play and the position wait for it.
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Play (k)' })

        // The server's address now refuses every connection, and the file still plays.
        await gone.close()
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Pause (k)' })
        await expectClockMoving(page)
      },
    })

    await withApp({
      userData,
      env: { RAVEN_DESKTOP_SYNC_RETRY_MS: SYNC_RETRY_HOOK_MS },
      run: async ({ page, output }) => {
        await expect(homeHeading(page)).toBeVisible()
        // A try finds the server still gone, so only a later retry can reach it.
        await expect
          .poll(
            () =>
              output
                .lines()
                .some(
                  (line) =>
                    line.includes(`${PLAYED.method} ${PLAYED.path}`) && line.includes('failed'),
                ),
            { timeout: FAILED_TRY_WAIT_MS },
          )
          .toBe(true)
        // A restarted server forgets every unlock, and nothing in this launch gives the PIN
        // again, so the server back at the stored address holds no lock.
        const back = await startFixtureServer({
          clips: fixtureClips,
          mode: { ...LOCKED, isLocked: false },
          mediaPlane: true,
          port,
        })
        started = back
        const heard = (route: { method: string; path: string }) =>
          requestsTo({ requests: back.requests, ...route })
        await expect
          .poll(() => heard(PLAYED).length > 0 && heard(SAVED).length > 0, {
            timeout: LATE_REPORT_WAIT_MS,
          })
          .toBe(true)
        const routes = routesOf(back.requests)
        // The play goes first, so the server hears it before a position that may mark it watched.
        expect(routes.indexOf(`${PLAYED.method} ${PLAYED.path}`)).toBeLessThan(
          routes.indexOf(`${SAVED.method} ${SAVED.path}`),
        )
        const [saved] = heard(SAVED)
        expect(saved === undefined ? null : positionOf(saved)).toBeGreaterThan(0)
      },
    })
  })
})

test.describe.serial('downloading through the server', () => {
  let userData = ''
  let started: FixtureServer | null = null

  const server = (): FixtureServer => {
    if (started === null) throw new Error('The fixture server is not running.')
    return started
  }

  test.beforeAll(async () => {
    userData = await freshUserData()
    started = await startLockedFixture({ mediaPlane: false })
  })

  test.afterAll(async () => {
    const closing = started === null ? Promise.resolve() : started.close()
    await closing.finally(() => removeDir(userData))
  })

  test('fetches the file from the server with its cookie when it lists no media origin', async () => {
    const fixture = server()
    const size = sizeOf(FIXTURE_MEDIA.first)
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await expect(homeHeading(page)).toBeVisible()
        await stubTrustPrompt({ app, answer: 'add' })
        await download({
          app,
          page,
          fixture,
          target: { kind: 'media', mediaId: FIXTURE_MEDIA.first },
          question: `Download Fixture One (1 movie, ${formatBytes(size)})`,
        })
        await openDownloads({ page })
        await expectReady({ page, label: 'Fixture One', size })
      },
    })

    const files = fileFetches({ requests: fixture.requests, mediaId: FIXTURE_MEDIA.first })
    expect(files.length).toBeGreaterThan(0)
    expect(files.every(({ hasUnlock, hasTicket }) => hasUnlock && !hasTicket)).toBe(true)
    expect(
      requestsTo({ requests: fixture.requests, method: 'GET', path: '/api/media/1/ticket' }),
    ).toEqual([])
    expect(routesOf(fixture.elsewhere.requests)).toEqual([])
  })

  test('downloads a whole season, and Home counts what is left', async () => {
    const ownUserData = await freshUserData()
    const fixture = server()
    const bytes = sizeOf(FIXTURE_MEDIA.first) + sizeOf(FIXTURE_MEDIA.second)
    // Each file is held until the test lets it go, so the count steps down one at a time.
    const releaseFirst = fixture.stall({ path: /^\/api\/media\/1\/file/u })
    const releaseSecond = fixture.stall({ path: /^\/api\/media\/2\/file/u })
    try {
      await withApp({
        userData: ownUserData,
        run: async ({ app, page }) => {
          await expect(homeHeading(page)).toBeVisible()
          await stubTrustPrompt({ app, answer: 'add' })
          await download({
            app,
            page,
            fixture,
            target: { kind: 'item', itemId: FIXTURE_ITEMS.season },
            question: `(2 episodes, ${formatBytes(bytes)})`,
          })
          await expect(downloadsButton({ page, count: 2 })).toBeVisible()
          releaseFirst()
          await expect(downloadsButton({ page, count: 1 })).toBeVisible({ timeout: READY_WAIT_MS })
          releaseSecond()
          await expect(downloadsButton({ page, count: 0 })).toBeVisible({ timeout: READY_WAIT_MS })
          await openDownloads({ page })
          await expect(page.getByRole('button', { name: /^Play /u })).toHaveCount(2)
        },
      })
    } finally {
      releaseFirst()
      releaseSecond()
      await removeDir(ownUserData)
    }
  })

  test('deletes at launch a download watched eleven minutes ago, and says so', async () => {
    const ownUserData = await freshUserData()
    const fixture = server()
    const serverId = randomUUID()
    const at = Date.now()
    const container = containerOf(fixtureClips.tracks)
    const config: DesktopConfig = {
      ...EMPTY_CONFIG,
      servers: [
        {
          id: serverId,
          origin: fixture.origin,
          name: hostOf({ fixture }),
          addedAt: at - 60 * MINUTE_MS,
        },
      ],
    }
    const seeded: DownloadsState = {
      version: 1,
      entries: [
        {
          downloadId: randomUUID(),
          serverId,
          mediaId: FIXTURE_MEDIA.first,
          label: 'Fixture One',
          group: { kind: 'movie', key: 'movie:1', title: 'Fixture One', order: 0 },
          container,
          size: sizeOf(FIXTURE_MEDIA.first),
          duration: 30,
          watchedPercent: 90,
          sidecars: [],
          status: { kind: 'ready' },
          autoDelete: true,
          watchedAt: at - 11 * MINUTE_MS,
          serverPosition: 0,
          pending: { play: false, position: null, furthest: null, at: 0 },
          createdAt: at - 60 * MINUTE_MS,
        },
      ],
      autoDeleteDefault: false,
      owed: [],
    }
    if (!isDownloadsState(seeded)) throw new Error('The seeded downloads are not what main reads.')
    const folder = entryDirFor({ userData: ownUserData, serverId, mediaId: FIXTURE_MEDIA.first })
    try {
      await mkdir(folder, { recursive: true })
      await copyFile(
        fixtureClips.tracks,
        videoPathFor({ userData: ownUserData, serverId, mediaId: FIXTURE_MEDIA.first, container }),
      )
      await Promise.all([
        writeFile(join(ownUserData, CONFIG_FILE), JSON.stringify(config)),
        writeFile(join(ownUserData, DOWNLOADS_FILE), JSON.stringify(seeded)),
      ])
      await withApp({
        userData: ownUserData,
        run: async ({ page }) => {
          await expect(page.getByText('Deleted Fixture One after watching')).toBeVisible({
            timeout: NOTICE_WAIT_MS,
          })
          await expect.poll(() => isPresent(folder)).toBe(false)
        },
      })
      const stored = await storedDownloads({ userData: ownUserData })
      expect(stored.entries).toEqual([])
      expect(stored.owed).toEqual([])
    } finally {
      await removeDir(ownUserData)
    }
  })
})
