import { execFile } from 'node:child_process'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { type Clips, makeClips, makeTrackClip } from '@/e2e/clips'
import {
  closeApp,
  freshUserData,
  launchApp,
  markWithin,
  openFile,
  removeDir,
  watchedPercent,
  withApp,
} from '@/e2e/harness'
import { postOnPort, tapPlayerPort, trafficOf } from '@/e2e/playerPort'

// Twice the 20 ms main thread budget (spec section 8), as P4 does for launch.
const LOOP_LAG_LIMIT_MS = 40
// The first lag mark comes five seconds into playback; this only turns a missed one into an error.
const LOOP_MARK_WAIT_MS = 15_000
const FIRST_FRAME_WAIT_MS = 10_000
// Spec Review Focus 5: mpv is destroyed and the app gone within a second of quitting.
const QUIT_LIMIT_MS = 1000
const NEXT_WAIT_MS = 15_000
// The window's colour on Home and under a video, as Electron reports them: main sets the
// clear one as `#00000000`, and `getBackgroundColor` leaves the alpha off.
const NIGHT = '#15201E'
const CLEAR = '#000000'

const heading = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('heading', { name, exact: true })

const homeHeading = (page: Page) => page.getByRole('heading', { name: 'raven player' })

/** A pointer move wakes the controls, which hold their clock while hidden (Ruling 7). */
const wake = async (page: Page) => {
  await page.mouse.move(120, 120)
  await page.mouse.move(160, 140)
}

/** The scrubber's position in whole seconds, read with the controls awake. */
const clockOf = async (page: Page): Promise<number | null> => {
  await wake(page)
  const now = await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuenow')
  return now === null ? null : Number(now)
}

/** The clock moves more than a second past where it is now: a stuck clock fails here. */
const expectClockAdvancing = async (page: Page) => {
  const start = (await clockOf(page)) ?? Number.POSITIVE_INFINITY
  await expect
    .poll(async () => ((await clockOf(page)) ?? Number.NEGATIVE_INFINITY) - start)
    .toBeGreaterThan(1)
}

const distanceFrom = async ({ page, seconds }: { page: Page; seconds: number }) => {
  const now = await clockOf(page)
  return now === null ? Number.POSITIVE_INFINITY : Math.abs(now - seconds)
}

/** mpv plays it: the page has no `<video>`, and the stage says its picture is native. */
const expectNative = async (page: Page) => {
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'native')
}

const expectButton = async ({ page, name }: { page: Page; name: string }) => {
  await wake(page)
  await expect(page.getByRole('button', { name })).toBeVisible()
}

/** Plays `path` through mpv and waits until its clock is moving. */
const playNatively = async ({
  app,
  page,
  path,
  title,
}: {
  app: ElectronApplication
  page: Page
  path: string
  title: string
}) => {
  await openFile({ app, path })
  await expect(heading({ page, name: title })).toBeVisible()
  await expectNative(page)
  await expectButton({ page, name: 'Pause (k)' })
  await expectClockAdvancing(page)
}

/** The reply to each request of `type` the page sent, in order; null for one not answered yet. */
const repliesTo = async ({ page, type }: { page: Page; type: string }) => {
  const { requests, replies } = await trafficOf({ page })
  return requests
    .filter((sent) => sent.command.type === type)
    .map((sent) => replies.find((reply) => reply.id === sent.id) ?? null)
}

const lastReplyOf = async ({ page, type }: { page: Page; type: string }) =>
  (await repliesTo({ page, type })).at(-1) ?? null

/** The pids `pgrep` lists as children of `pid`; it exits 1, with no output, when there are none. */
const childrenOf = ({ pid }: { pid: number }) =>
  new Promise<number[]>((resolve) => {
    execFile('pgrep', ['-P', `${pid}`], (_error, stdout) =>
      resolve(
        stdout
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map(Number),
      ),
    )
  })

/** The app's process and every process under it (Electron's helpers), by pid. */
const processTree = async ({ pid }: { pid: number }): Promise<number[]> => {
  const children = await childrenOf({ pid })
  const below = await Promise.all(children.map((child) => processTree({ pid: child })))
  return [pid, ...below.flat()]
}

// Signal 0 only asks whether the process exists; EPERM means it does, under another user.
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** The window's background as Electron reports it: night on Home, clear under a video. */
const backgroundOf = (app: ElectronApplication): Promise<string | null> =>
  app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor() ?? null,
  )

const audioGroup = (page: Page) => page.getByRole('group', { name: 'Audio' })
const subtitleGroup = (page: Page) => page.getByRole('group', { name: 'Subtitles' })

const openSettings = async (page: Page) => {
  await wake(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(audioGroup(page)).toBeVisible()
}

test.describe.serial('playing a local file through mpv', () => {
  let userData = ''
  let clips: Clips = { folder: '', first: '', second: '' }
  let tracks = { folder: '', path: '' }

  test.beforeAll(async () => {
    userData = await freshUserData()
    const [made, track] = await Promise.all([makeClips(), makeTrackClip()])
    clips = made
    tracks = track
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(userData), removeDir(clips.folder), removeDir(tracks.folder)])
  })

  test('plays natively, pauses, seeks and resumes after a relaunch', async () => {
    await withApp({
      userData,
      run: async (launched) => {
        const { app, page } = launched
        await playNatively({ app, page, path: clips.first, title: 'Clip 01' })

        const volume = page.getByRole('slider', { name: 'Volume' })
        await wake(page)
        const loud = Number(await volume.inputValue())
        await page.keyboard.press('ArrowDown')
        await wake(page)
        await expect(volume).toHaveValue(`${loud - 5}`)

        // Paused before the seek, so the position main stores is exactly half way.
        await page.keyboard.press('k')
        await expectButton({ page, name: 'Play (k)' })
        await page.keyboard.press('5')
        await expect.poll(() => distanceFrom({ page, seconds: 15 })).toBeLessThanOrEqual(1)
        await expect.poll(() => watchedPercent({ page, label: 'Clip 01' })).toBe(50)

        const firstFrame = await markWithin({
          launched,
          name: 'first-frame-ms',
          ms: FIRST_FRAME_WAIT_MS,
        })
        expect(firstFrame).toBeGreaterThanOrEqual(0)
      },
    })

    await withApp({
      userData,
      run: async ({ app, page }) => {
        await openFile({ app, path: clips.first })
        await expect(page.getByText('Resumed at 0:15')).toBeVisible()
        await expectNative(page)
        await expect.poll(async () => (await clockOf(page)) ?? 0).toBeGreaterThanOrEqual(14)
        await expectClockAdvancing(page)
      },
    })
  })

  test('keeps the main process responsive while playing', async () => {
    await withApp({
      userData,
      run: async (launched) => {
        const { app, page } = launched
        await playNatively({ app, page, path: clips.first, title: 'Clip 01' })
        const lag = await markWithin({ launched, name: 'loop-lag-p99-ms', ms: LOOP_MARK_WAIT_MS })
        expect(lag).toBeLessThan(LOOP_LAG_LIMIT_MS)
      },
    })
  })

  test('plays the next video in the folder when one ends', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await playNatively({ app, page, path: clips.first, title: 'Clip 01' })
        await page.keyboard.press('End')
        await expect(heading({ page, name: 'Clip 02 Été' })).toBeVisible({ timeout: NEXT_WAIT_MS })
        await expectNative(page)
        await expectClockAdvancing(page)
      },
    })
  })

  test('switches audio and subtitles and remembers the pick', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await playNatively({ app, page, path: tracks.path, title: 'Tracks 01' })
        await openSettings(page)
        await expect(audioGroup(page).getByRole('radio', { name: 'English' })).toBeChecked()
        await expect(subtitleGroup(page).getByRole('radio', { name: 'Off' })).toBeChecked()

        await audioGroup(page).getByRole('radio', { name: 'French' }).check()
        await expect(audioGroup(page).getByRole('radio', { name: 'French' })).toBeChecked()
        await expect.poll(() => lastReplyOf({ page, type: 'audio' })).toMatchObject({ ok: true })

        await subtitleGroup(page).getByRole('radio', { name: 'English' }).check()
        await expect(subtitleGroup(page).getByRole('radio', { name: 'English' })).toBeChecked()
        await expect.poll(() => lastReplyOf({ page, type: 'subtitle' })).toMatchObject({ ok: true })

        const { requests } = await trafficOf({ page })
        expect(
          requests.map(({ command }) => command).filter((command) => command.type === 'audio'),
        ).toEqual([{ type: 'audio', index: 1 }])
        await expectClockAdvancing(page)
      },
    })

    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await openFile({ app, path: tracks.path })
        await expect(heading({ page, name: 'Tracks 01' })).toBeVisible()
        await expect.poll(() => lastReplyOf({ page, type: 'load' })).toMatchObject({ ok: true })
        // The stored pick goes to mpv with the load itself, not as a later switch.
        const { requests } = await trafficOf({ page })
        expect(
          requests.find(({ command }) => command.type === 'load')?.command ?? null,
        ).toMatchObject({
          type: 'load',
          audio: 1,
          subtitle: 'embedded-0',
        })
        await openSettings(page)
        await expect(audioGroup(page).getByRole('radio', { name: 'French' })).toBeChecked()
        await expect(subtitleGroup(page).getByRole('radio', { name: 'English' })).toBeChecked()
      },
    })
  })

  test('offers video info', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })
        await page.keyboard.press('?')
        await expect(page.getByText('Video info')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByText('Video info')).toHaveCount(0)

        await page.keyboard.press('i')
        await expect.poll(() => lastReplyOf({ page, type: 'stats' })).toMatchObject({ ok: true })
        await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0)
        await expectNative(page)
        await expectClockAdvancing(page)
      },
    })
  })

  test('goes back home with Escape and with Back, stopping mpv each time', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })
        await page.keyboard.press('Escape')
        await expect(homeHeading(page)).toBeVisible()
        await expect(page.locator('html')).not.toHaveAttribute('data-surface', 'native')
        await expect.poll(() => lastReplyOf({ page, type: 'stop' })).toMatchObject({ ok: true })
        expect(await backgroundOf(app)).toBe(NIGHT)

        const stops = (await repliesTo({ page, type: 'stop' })).length
        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })
        await wake(page)
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await expect(homeHeading(page)).toBeVisible()
        await expect(page.locator('html')).not.toHaveAttribute('data-surface', 'native')
        await expect
          .poll(async () => {
            const added = (await repliesTo({ page, type: 'stop' })).slice(stops)
            return added.length > 0 && added.every((reply) => reply?.ok ?? false)
          })
          .toBe(true)
        expect(await backgroundOf(app)).toBe(NIGHT)
      },
    })
  })

  test('hands a reloaded page a fresh port and plays again', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })

        // A second `ready`: main closes the old port, which stops mpv, and hands over a new
        // one. Each page load starts on Home, so the video opens again from there.
        await page.reload()
        await expect.poll(async () => (await trafficOf({ page })).ports).toBe(1)
        // Main put the window back for Home before it handed the new page its port.
        expect(await backgroundOf(app)).toBe(NIGHT)
        await expect(homeHeading(page)).toBeVisible()
        await expect(page.locator('html')).not.toHaveAttribute('data-surface', 'native')

        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })
        await expect.poll(() => lastReplyOf({ page, type: 'load' })).toMatchObject({ ok: true })
        expect(
          (await trafficOf({ page })).events.filter((event) => event.type === 'error'),
        ).toEqual([])
      },
    })
  })

  test('refuses forged commands on the player port and plays nothing', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        // A granted file, so a forgery has a real grant beside it to reach for.
        await playNatively({ app, page, path: clips.first, title: 'Clip 01' })
        expect(await backgroundOf(app)).toBe(CLEAR)
        await page.keyboard.press('Escape')
        await expect(homeHeading(page)).toBeVisible()
        await tapPlayerPort({ page })

        const ungranted = '00000000-0000-4000-8000-000000000000'
        const load = { type: 'load', start: 0, audio: null, subtitle: null }
        const forgeries = [
          { id: 'one', command: { type: 'play' } },
          { id: 9001, command: { type: 'run', args: ['loadfile', clips.first] } },
          { id: 9002, command: ['loadfile', clips.first, 'replace'] },
          { id: 9003, command: { type: 'loadfile', url: clips.first } },
          { id: 9004, command: { ...load, source: { kind: 'path', path: clips.first } } },
          { id: 9005, command: { ...load, source: { kind: 'file', fileId: ungranted } } },
          { id: 9006, command: { ...load, source: { kind: 'file', fileId: clips.first } } },
          {
            id: 9007,
            command: {
              ...load,
              source: { kind: 'file', fileId: ungranted, path: clips.first },
              path: clips.first,
              options: { 'access-references': 'yes' },
            },
          },
          // A command the port knows, so the port still answers after all of the above.
          { id: 9008, command: { type: 'subtitleScale', scale: 1 } },
        ]
        await postOnPort({ page, messages: forgeries })
        await expect.poll(async () => (await trafficOf({ page })).replies.length).toBe(8)

        const { replies, events, strays } = await trafficOf({ page })
        const unknown = 'raven player does not understand that command.'
        const notOpen = 'That video is no longer open. Open it again from Home.'
        expect(replies).toEqual([
          { id: 9001, ok: false, reason: 'refused', message: unknown },
          { id: 9002, ok: false, reason: 'refused', message: unknown },
          { id: 9003, ok: false, reason: 'refused', message: unknown },
          { id: 9004, ok: false, reason: 'refused', message: unknown },
          { id: 9005, ok: false, reason: 'refused', message: notOpen },
          { id: 9006, ok: false, reason: 'refused', message: notOpen },
          { id: 9007, ok: false, reason: 'refused', message: notOpen },
          { id: 9008, ok: true },
        ])
        expect(events).toEqual([])
        expect(strays).toEqual([])
        // A load main accepts makes the window clear for the picture before it answers, so
        // an opaque window once every reply is in means none of them reached mpv.
        expect(await backgroundOf(app)).toBe(NIGHT)
        await expect(homeHeading(page)).toBeVisible()
        await expect(page.locator('html')).not.toHaveAttribute('data-surface', 'native')
      },
    })
  })

  test('quits mid-film within a second and leaves no process behind', async () => {
    const { app, page } = await launchApp({ userData })
    try {
      await playNatively({ app, page, path: clips.first, title: 'Clip 01' })
      const pid = app.process().pid
      if (pid === undefined) throw new Error('raven player has no process id.')
      const tree = await processTree({ pid })
      // Electron's helpers (GPU, network, renderer) are in the tree, so this proves more than main.
      expect(tree.length).toBeGreaterThan(1)

      const startedAt = performance.now()
      await closeApp({ app })
      const quitMs = performance.now() - startedAt
      process.stdout.write(`raven quit ${Math.round(quitMs)} ms, ${tree.length} processes\n`)
      expect(quitMs).toBeLessThan(QUIT_LIMIT_MS)
      await expect.poll(() => tree.filter(isAlive)).toEqual([])
    } finally {
      // Already gone when the test passed; a failure above must not leave the app running,
      // and a second failure here must not hide the first.
      await closeApp({ app }).catch(() => undefined)
    }
  })
})
