import { execFile } from 'node:child_process'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import {
  PLAYER_COMMANDS,
  PLAYER_EVENTS,
  PLAYER_REFUSAL_REASONS,
  PLAYER_SOURCE_KINDS,
  type PlayerCommand,
} from '@raven/core'
import { type Clips, makeClips, makeTrackClip } from '@/e2e/clips'
import {
  closeApp,
  expectOffline,
  freshUserData,
  heading,
  launchApp,
  markWithin,
  openFile,
  removeDir,
  watchedPercent,
  withApp,
} from '@/e2e/harness'
import { postOnPort, tapPlayerPort, trafficOf } from '@/e2e/playerPort'
import {
  clockOf,
  distanceFrom,
  expectButton,
  expectClockAdvancing,
  expectNative,
  expectPlayingNatively,
  wake,
} from '@/e2e/playerView'

// Twice the 20 ms main thread budget (spec section 8), as P4 does for launch.
const LOOP_LAG_LIMIT_MS = 40
// The first lag mark comes five seconds into playback; this only turns a missed one into an error.
const LOOP_MARK_WAIT_MS = 15_000
const FIRST_FRAME_WAIT_MS = 10_000
// Spec Review Focus 5: mpv is destroyed and the app gone within a second of quitting, read
// from main's own mark. The wall clock only guards against a hang.
const QUIT_LIMIT_MS = 1000
const QUIT_HANG_MS = 3000
const QUIT_MARK_WAIT_MS = 1000
const NEXT_WAIT_MS = 15_000
// The window's colour behind the page and under a video, as Electron reports them: main sets
// the clear one as `#00000000`, and `getBackgroundColor` leaves the alpha off.
const NIGHT = '#15201E'
const CLEAR = '#000000'
const ERROR_CODES = { eperm: 'EPERM' } as const

type PlayNativelyProps = {
  app: ElectronApplication
  page: Page
  path: string
  title: string
}

/** Plays `path` through mpv and waits until its clock is moving. */
const playNatively = async ({ app, page, path, title }: PlayNativelyProps) => {
  await openFile({ app, path })
  await expectPlayingNatively({ page, title })
}

/** The player has gone and the page it left is back: no `/play` route and no picture under it. */
const expectLeftPlayer = async (page: Page) => {
  await expectOffline({ page })
  await expect(page.locator('html')).not.toHaveAttribute('data-surface', 'native')
}

type RepliesToProps = { page: Page; type: PlayerCommand['type'] }

/** The reply to each request of `type` the page sent, in order; null for one not answered yet. */
const repliesTo = async ({ page, type }: RepliesToProps) => {
  const { requests, replies } = await trafficOf({ page })
  return requests
    .filter((sent) => sent.command.type === type)
    .map((sent) => replies.find((reply) => reply.id === sent.id) ?? null)
}

type LastReplyOfProps = { page: Page; type: PlayerCommand['type'] }

const lastReplyOf = async ({ page, type }: LastReplyOfProps) =>
  (await repliesTo({ page, type })).at(-1) ?? null

/** The volume, in whole percent, of the last volume command the page sent mpv; null before any. */
const lastVolumeSent = async (page: Page): Promise<number | null> => {
  const { requests } = await trafficOf({ page })
  const volumes = requests.flatMap(({ command }) =>
    command.type === PLAYER_COMMANDS.volume ? [Math.round(command.volume * 100)] : [],
  )
  return volumes.at(-1) ?? null
}

type ChildrenOfProps = { pid: number }

/** The pids `pgrep` lists as children of `pid`; it exits 1, with no output, when there are none. */
const childrenOf = ({ pid }: ChildrenOfProps) =>
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

type ProcessTreeProps = { pid: number }

/** The app's process and every process under it (Electron's helpers), by pid. */
const processTree = async ({ pid }: ProcessTreeProps): Promise<number[]> => {
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
    return error instanceof Error && 'code' in error && error.code === ERROR_CODES.eperm
  }
}

/** The window's background as Electron reports it: night behind a page, clear under a video. */
const backgroundOf = (app: ElectronApplication): Promise<string | null> =>
  app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor() ?? null,
  )

const audioGroup = (page: Page) => page.getByRole('group', { name: 'Audio' })
const subtitleGroup = (page: Page) => page.getByRole('group', { name: 'Subtitles' })

type OpenMenuProps = { page: Page; name: 'Audio' | 'Subtitles' }

/** Opens the menu behind the Audio or Subtitles pill, whose radios are named for it. */
const openMenu = async ({ page, name }: OpenMenuProps) => {
  await wake(page)
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('group', { name })).toBeVisible()
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
        await tapPlayerPort({ page })
        await playNatively({ app, page, path: clips.first, title: 'Clip 01' })

        // Read from what mpv is sent, since the slider hides on a window as narrow as CI's.
        await expect.poll(() => lastVolumeSent(page)).not.toBeNull()
        const loud = (await lastVolumeSent(page)) ?? 0
        await page.keyboard.press('ArrowDown')
        await expect.poll(() => lastVolumeSent(page)).toBe(loud - 5)

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
        await openMenu({ page, name: 'Audio' })
        await expect(audioGroup(page).getByRole('radio', { name: 'English' })).toBeChecked()

        await audioGroup(page).getByRole('radio', { name: 'French' }).check()
        await expect(audioGroup(page).getByRole('radio', { name: 'French' })).toBeChecked()
        await expect
          .poll(() => lastReplyOf({ page, type: PLAYER_COMMANDS.audio }))
          .toMatchObject({ ok: true })

        await openMenu({ page, name: 'Subtitles' })
        await expect(subtitleGroup(page).getByRole('radio', { name: 'Off' })).toBeChecked()
        await subtitleGroup(page).getByRole('radio', { name: 'English' }).check()
        await expect(subtitleGroup(page).getByRole('radio', { name: 'English' })).toBeChecked()
        await expect
          .poll(() => lastReplyOf({ page, type: PLAYER_COMMANDS.subtitle }))
          .toMatchObject({ ok: true })

        const { requests } = await trafficOf({ page })
        expect(
          requests
            .map(({ command }) => command)
            .filter((command) => command.type === PLAYER_COMMANDS.audio),
        ).toEqual([{ type: PLAYER_COMMANDS.audio, index: 1 }])
        await expectClockAdvancing(page)
      },
    })

    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await openFile({ app, path: tracks.path })
        await expect(heading({ page, name: 'Tracks 01' })).toBeVisible()
        await expect
          .poll(() => lastReplyOf({ page, type: PLAYER_COMMANDS.load }))
          .toMatchObject({ ok: true })
        // The stored pick goes to mpv with the load itself, not as a later switch.
        const { requests } = await trafficOf({ page })
        expect(
          requests.find(({ command }) => command.type === PLAYER_COMMANDS.load)?.command ?? null,
        ).toMatchObject({
          type: PLAYER_COMMANDS.load,
          audio: 1,
          subtitle: 'embedded-0',
        })
        await openMenu({ page, name: 'Audio' })
        await expect(audioGroup(page).getByRole('radio', { name: 'French' })).toBeChecked()
        await openMenu({ page, name: 'Subtitles' })
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
        await expect
          .poll(() => lastReplyOf({ page, type: PLAYER_COMMANDS.stats }))
          .toMatchObject({ ok: true })
        await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0)
        await expectNative(page)
        await expectClockAdvancing(page)
      },
    })
  })

  test('goes back to the page it left with Escape and with Back, stopping mpv each time', async () => {
    await withApp({
      userData,
      run: async ({ app, page }) => {
        await tapPlayerPort({ page })
        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })
        await page.keyboard.press('Escape')
        await expectLeftPlayer(page)
        await expect
          .poll(() => lastReplyOf({ page, type: PLAYER_COMMANDS.stop }))
          .toMatchObject({ ok: true })
        expect(await backgroundOf(app)).toBe(NIGHT)

        const stops = (await repliesTo({ page, type: PLAYER_COMMANDS.stop })).length
        await playNatively({ app, page, path: clips.second, title: 'Clip 02 Été' })
        await wake(page)
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await expectLeftPlayer(page)
        await expect
          .poll(async () => {
            const added = (await repliesTo({ page, type: PLAYER_COMMANDS.stop })).slice(stops)
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
        // one. The page reloads on the same file, which it opens again on the new port.
        await page.reload()
        await expect.poll(async () => (await trafficOf({ page })).ports).toBe(1)
        await expectPlayingNatively({ page, title: 'Clip 02 Été' })
        expect(await backgroundOf(app)).toBe(CLEAR)
        await expect
          .poll(() => lastReplyOf({ page, type: PLAYER_COMMANDS.load }))
          .toMatchObject({ ok: true })
        expect(
          (await trafficOf({ page })).events.filter((event) => event.type === PLAYER_EVENTS.error),
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
        await expectLeftPlayer(page)
        await tapPlayerPort({ page })

        const ungranted = '00000000-0000-4000-8000-000000000000'
        const load = { type: PLAYER_COMMANDS.load, start: 0, audio: null, subtitle: null }
        const forgeries = [
          { id: 'one', command: { type: PLAYER_COMMANDS.play } },
          { id: 9001, command: { type: 'run', args: ['loadfile', clips.first] } },
          { id: 9002, command: ['loadfile', clips.first, 'replace'] },
          { id: 9003, command: { type: 'loadfile', url: clips.first } },
          { id: 9004, command: { ...load, source: { kind: 'path', path: clips.first } } },
          {
            id: 9005,
            command: { ...load, source: { kind: PLAYER_SOURCE_KINDS.file, fileId: ungranted } },
          },
          {
            id: 9006,
            command: { ...load, source: { kind: PLAYER_SOURCE_KINDS.file, fileId: clips.first } },
          },
          {
            id: 9007,
            command: {
              ...load,
              source: { kind: PLAYER_SOURCE_KINDS.file, fileId: ungranted, path: clips.first },
              path: clips.first,
              options: { 'access-references': 'yes' },
            },
          },
          // A command the port knows, so the port still answers after all of the above.
          { id: 9008, command: { type: PLAYER_COMMANDS.subtitleScale, scale: 1 } },
        ]
        await postOnPort({ page, messages: forgeries })
        await expect.poll(async () => (await trafficOf({ page })).replies.length).toBe(8)

        const { replies, events, strays } = await trafficOf({ page })
        const unknown = 'Raven does not understand that command.'
        const notOpen = 'That video is no longer open. Open it again from On this Mac or Downloads.'
        expect(replies).toEqual([
          { id: 9001, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: unknown },
          { id: 9002, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: unknown },
          { id: 9003, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: unknown },
          { id: 9004, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: unknown },
          { id: 9005, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: notOpen },
          { id: 9006, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: notOpen },
          { id: 9007, ok: false, reason: PLAYER_REFUSAL_REASONS.refused, message: notOpen },
          { id: 9008, ok: true },
        ])
        expect(events).toEqual([])
        expect(strays).toEqual([])
        // A load main accepts makes the window clear for the picture before it answers, so
        // an opaque window once every reply is in means none of them reached mpv.
        expect(await backgroundOf(app)).toBe(NIGHT)
        await expectLeftPlayer(page)
      },
    })
  })

  test('quits mid-film within a second and leaves no process behind', async () => {
    const launched = await launchApp({ userData })
    const { app, page } = launched
    try {
      await playNatively({ app, page, path: clips.first, title: 'Clip 01' })
      const pid = app.process().pid
      if (pid === undefined) throw new Error('Raven has no process id.')
      const tree = await processTree({ pid })
      // Electron's helpers (GPU, network, renderer) are in the tree, so this proves more than main.
      expect(tree.length).toBeGreaterThan(1)

      const startedAt = performance.now()
      await closeApp({ app })
      const wallMs = performance.now() - startedAt
      const quitMs = await markWithin({ launched, name: 'quit-ms', ms: QUIT_MARK_WAIT_MS })
      process.stdout.write(
        `raven quit ${quitMs} ms (main), ${Math.round(wallMs)} ms (test), ${tree.length} processes\n`,
      )
      expect(quitMs).toBeLessThan(QUIT_LIMIT_MS)
      expect(wallMs).toBeLessThan(QUIT_HANG_MS)
      await expect.poll(() => tree.filter(isAlive)).toEqual([])
    } finally {
      // Already gone when the test passed; a failure above must not leave the app running,
      // and a second failure here must not hide the first.
      await closeApp({ app }).catch(() => undefined)
    }
  })
})
