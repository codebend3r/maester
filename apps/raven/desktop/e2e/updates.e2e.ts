import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, type Page, test } from '@playwright/test'
import { DESKTOP_REPLIES, DESKTOP_REQUESTS, isRecord, isString } from '@raven/core'
import {
  browserOpens,
  expectOffline,
  freshUserData,
  removeDir,
  requestFromPage,
  sideLink,
  stubBrowser,
  withApp,
} from '@/e2e/harness'
import { type ReleasesFixture, startReleasesFixture } from '@/e2e/releasesFixture'

const CONFIG_FILE = 'desktop-config.json'
const NOTICE_WAIT_MS = 10_000
// Long enough for a launch check against a local fixture to have asked, had it been going to.
const QUIET_MS = 3000

/** The version `package.json` gives the app, which `app.getVersion()` reports unpackaged. */
const appVersion = async (): Promise<string> => {
  const text = await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8')
  const manifest: unknown = JSON.parse(text)
  if (!isRecord(manifest) || !isString(manifest.version)) {
    throw new Error('package.json names no version')
  }
  return manifest.version
}

const release = ({
  tag,
  isPrerelease = false,
  dmg = null,
}: {
  tag: string
  isPrerelease?: boolean
  dmg?: string | null
}) => ({
  tag_name: tag,
  draft: false,
  prerelease: isPrerelease,
  assets: dmg === null ? [] : [{ name: dmg }],
})

/** The toast main's notice of a newer release raises, over whatever page is open. */
const updateNotice = (page: Page) => page.getByText(/^raven player [\d.]+ is out\. Settings has/u)

/** Settings' Updates section, from the side menu of the frame a launch with no server opens. */
const openUpdates = async (page: Page) => {
  await expectOffline({ page })
  await sideLink({ page, name: 'Settings' }).click()
  const updates = page.getByRole('region', { name: 'Updates' })
  await expect(updates).toBeVisible()
  return updates
}

/** What main says about the release check, once it has an answer from the fixture. */
const checkedStatus = async (page: Page) => {
  const reply = await requestFromPage({ page, request: { type: DESKTOP_REQUESTS.readUpdates } })
  if (reply === null || reply.type !== DESKTOP_REPLIES.updates || reply.status.checkedAt === null) {
    return null
  }
  return { latest: reply.status.latest, problem: reply.status.problem }
}

/** The stored config with `edit` applied to its `updates`, written back as main keeps it. */
const editUpdates = async ({
  userData,
  edit,
}: {
  userData: string
  edit: (updates: Record<string, unknown>) => Record<string, unknown>
}): Promise<void> => {
  const file = join(userData, CONFIG_FILE)
  const config: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isRecord(config) || !isRecord(config.updates)) throw new Error('no update settings stored')
  await writeFile(file, `${JSON.stringify({ ...config, updates: edit(config.updates) })}\n`)
}

const storedIsEnabled = async ({ userData }: { userData: string }): Promise<unknown> => {
  const text = await readFile(join(userData, CONFIG_FILE), 'utf8').catch(() => null)
  if (text === null) return null
  const config: unknown = JSON.parse(text)
  if (!isRecord(config) || !isRecord(config.updates)) return null
  return config.updates.isEnabled
}

const withFixture = async ({
  releases,
  pages,
  run,
}: {
  releases?: unknown
  pages?: readonly unknown[]
  run: (input: { fixture: ReleasesFixture; userData: string }) => Promise<void>
}): Promise<void> => {
  // One after the other inside the try, so whichever was made is cleaned up when the other fails.
  let fixture: ReleasesFixture | null = null
  let userData = ''
  try {
    fixture = await startReleasesFixture({ releases, pages })
    userData = await freshUserData()
    await run({ fixture, userData })
  } finally {
    await Promise.all([fixture === null ? undefined : fixture.close(), removeDir(userData)])
  }
}

test.describe('the release check', () => {
  test('tells you about a newer release and opens its page', async () => {
    await withFixture({
      releases: [release({ tag: 'v99.0.0', dmg: 'raven-player-99.0.0-arm64.dmg' })],
      run: async ({ fixture, userData }) => {
        await withApp({
          userData,
          env: { RAVEN_DESKTOP_RELEASES_URL: fixture.url },
          run: async ({ app, page }) => {
            await stubBrowser({ app })
            const notice = updateNotice(page)
            await expect(notice).toBeVisible({ timeout: NOTICE_WAIT_MS })
            await expect(notice).toHaveText("raven player 99.0.0 is out. Settings has what's new.")

            const updates = await openUpdates(page)
            await expect(updates.getByText('raven player 99.0.0 is out.')).toBeVisible()
            await updates.getByRole('button', { name: "See what's new" }).click()
            await expect
              .poll(() => browserOpens({ app }))
              .toEqual(['https://github.com/codebend3r/maester/releases/tag/v99.0.0'])
          },
        })
      },
    })
  })

  test('says nothing when this is the newest full release', async () => {
    const version = await appVersion()
    await withFixture({
      releases: [
        release({ tag: 'v99.0.0.1' }),
        release({
          tag: 'v99.1.0-rc.1',
          isPrerelease: true,
          dmg: 'raven-player-99.1.0-rc.1-arm64.dmg',
        }),
        release({ tag: 'v98.0.0' }),
        release({ tag: `v${version}`, dmg: `raven-player-${version}-arm64.dmg` }),
      ],
      run: async ({ fixture, userData }) => {
        await withApp({
          userData,
          env: { RAVEN_DESKTOP_RELEASES_URL: fixture.url },
          run: async ({ page }) => {
            await expectOffline({ page })
            // Main announces before it answers a later read, so a finished check has said all it will.
            await expect
              .poll(() => checkedStatus(page), { timeout: NOTICE_WAIT_MS })
              .toEqual({ latest: null, problem: null })
            await delay(QUIET_MS)
            await expect(updateNotice(page)).toHaveCount(0)
            expect(fixture.requests()).toBe(1)
          },
        })
      },
    })
  })

  test('finds a newer release behind a page of build releases', async () => {
    const builds = Array.from({ length: 40 }, (_, index) =>
      release({ tag: `v99.0.0.${40 - index}` }),
    )
    await withFixture({
      pages: [builds, [release({ tag: 'v99.0.0', dmg: 'raven-player-99.0.0-arm64.dmg' })]],
      run: async ({ fixture, userData }) => {
        await withApp({
          userData,
          env: { RAVEN_DESKTOP_RELEASES_URL: fixture.url },
          run: async ({ page }) => {
            const notice = updateNotice(page)
            await expect(notice).toBeVisible({ timeout: NOTICE_WAIT_MS })
            await expect(notice).toContainText('raven player 99.0.0 is out.')
            expect(fixture.requests()).toBe(2)
          },
        })
      },
    })
  })

  test('never claims the newest release when GitHub lists none with the app', async () => {
    const version = await appVersion()
    await withFixture({
      releases: Array.from({ length: 30 }, (_, index) =>
        release({ tag: `v${version}.${30 - index}` }),
      ),
      run: async ({ fixture, userData }) => {
        await withApp({
          userData,
          env: { RAVEN_DESKTOP_RELEASES_URL: fixture.url },
          run: async ({ page }) => {
            await expect
              .poll(() => checkedStatus(page), { timeout: NOTICE_WAIT_MS })
              .toEqual({ latest: null, problem: 'GitHub listed no raven player release.' })
            await expect(updateNotice(page)).toHaveCount(0)
            const updates = await openUpdates(page)
            await updates.getByRole('button', { name: 'Check now' }).click()
            await expect(updates.getByRole('status')).toHaveText(
              'raven player could not check for updates. GitHub listed no raven player release.',
            )
            await expect(updates.getByText(/is the newest release/)).toHaveCount(0)
          },
        })
      },
    })
  })

  test('never asks GitHub with the switch off', async () => {
    const version = await appVersion()
    await withFixture({
      releases: [release({ tag: `v${version}`, dmg: `raven-player-${version}-arm64.dmg` })],
      run: async ({ fixture, userData }) => {
        const env = { RAVEN_DESKTOP_RELEASES_URL: fixture.url }
        await withApp({
          userData,
          env,
          run: async ({ page }) => {
            await expect.poll(() => fixture.requests(), { timeout: NOTICE_WAIT_MS }).toBe(1)
            const updates = await openUpdates(page)
            const box = updates.getByRole('checkbox', { name: 'Check for updates once a day' })
            await expect(box).toBeChecked()
            await box.uncheck()
            await expect(box).not.toBeChecked()
            await expect.poll(() => storedIsEnabled({ userData })).toBe(false)
          },
        })

        // A check that is due by the clock, so only the switch keeps the next launch quiet.
        await editUpdates({ userData, edit: (updates) => ({ ...updates, checkedAt: null }) })

        await withApp({
          userData,
          env,
          run: async ({ page }) => {
            await expectOffline({ page })
            await delay(QUIET_MS)
            expect(fixture.requests()).toBe(1)
            const updates = await openUpdates(page)
            await expect(
              updates.getByRole('checkbox', { name: 'Check for updates once a day' }),
            ).not.toBeChecked()
          },
        })
      },
    })
  })
})
