import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { type DesktopReply, isDesktopReply } from '@/shared/protocol'

// `cwd` with `args: ['.']` runs the built app the way `electron .` does: package.json's `main`.
const PROJECT_DIR = join(import.meta.dirname, '..')
// A quit that hangs is a bug (the quit gate gives up flushing after a second), not a slow test.
const QUIT_MS = 10_000
const LAUNCH_MARK = /raven-launch-ms (\d+)/

export type Launched = {
  app: ElectronApplication
  page: Page
  /** main's `raven-launch-ms` mark, or null when the app exits without printing it. */
  launchMs: Promise<number | null>
}

export const freshUserData = (): Promise<string> => mkdtemp(join(tmpdir(), 'raven-e2e-user-'))

// A hook that failed before it made its folder leaves the path empty, which is not a folder to remove.
export const removeDir = async (path: string): Promise<void> => {
  if (path === '') return
  await rm(path, { recursive: true, force: true })
}

const hasExited = (app: ElectronApplication): boolean => {
  const child = app.process()
  return child.exitCode !== null || child.signalCode !== null
}

// Listens from the moment launch returns: Playwright holds `ready` until it has connected,
// so the window, and the mark printed when it is ready to show, come after.
const readLaunchMark = (app: ElectronApplication): Promise<number | null> =>
  new Promise((resolve) => {
    const { stdout } = app.process()
    if (stdout === null) return resolve(null)
    let text = ''
    const onData = (chunk: Buffer) => {
      text += chunk.toString('utf8')
      const ms = LAUNCH_MARK.exec(text)?.[1] ?? null
      if (ms === null) return
      stdout.off('data', onData)
      resolve(Number(ms))
    }
    stdout.on('data', onData)
    stdout.once('close', () => resolve(null))
  })

/**
 * main's launch mark, failing with a clear error when it has not been seen `ms` after the
 * window opened (it is printed at ready-to-show, so it is never far behind).
 */
export const launchMarkWithin = async ({
  launched,
  ms,
}: {
  launched: Launched
  ms: number
}): Promise<number> => {
  const deadline = new AbortController()
  const mark = await Promise.race([
    launched.launchMs,
    delay(ms, 'timeout' as const, { signal: deadline.signal }),
  ])
  deadline.abort()
  if (mark === 'timeout')
    throw new Error(`raven player's launch mark was not seen within ${ms} ms.`)
  if (mark === null) throw new Error('raven player quit before printing its launch mark.')
  return mark
}

/** Quits the app as a person would and waits for its process to end, killing it past the deadline. */
export const closeApp = async ({ app }: { app: ElectronApplication }): Promise<void> => {
  if (hasExited(app)) return
  const deadline = new AbortController()
  const outcome = await Promise.race([
    app.close().then(() => 'closed' as const),
    delay(QUIT_MS, 'timeout' as const, { signal: deadline.signal }),
  ])
  deadline.abort()
  if (outcome === 'closed') return
  app.process().kill('SIGKILL')
  throw new Error(`raven player did not quit within ${QUIT_MS} ms.`)
}

export const launchApp = async ({ userData }: { userData: string }): Promise<Launched> => {
  const app = await _electron.launch({
    // Chromium's fake audio sink: playback is clocked by the audio output, so a real device
    // whose clock has stalled (an asleep USB interface) would freeze `currentTime` at 0.
    args: ['--disable-audio-output', '.'],
    cwd: PROJECT_DIR,
    env: { ...process.env, RAVEN_DESKTOP_USER_DATA: userData },
  })
  const launchMs = readLaunchMark(app)
  const page = await app.firstWindow().catch(async (error: unknown) => {
    await closeApp({ app }).catch(() => undefined)
    throw error
  })
  return { app, page, launchMs }
}

/** Launches the app, runs `run` against it and always quits it after, so no process outlives a test. */
export const withApp = async <T>({
  userData,
  run,
}: {
  userData: string
  run: (launched: Launched) => Promise<T>
}): Promise<T> => {
  const launched = await launchApp({ userData })
  const result = await run(launched).catch(async (error: unknown) => {
    await closeApp({ app: launched.app }).catch(() => undefined)
    throw error
  })
  await closeApp({ app: launched.app })
  return result
}

/** The event Finder sends for "Open With" and a double-click, emitted on the running app. */
export const openFile = async ({
  app,
  path,
}: {
  app: ElectronApplication
  path: string
}): Promise<void> => {
  await app.evaluate(({ app: electronApp }, file) => {
    electronApp.emit('open-file', { preventDefault: () => undefined }, file)
  }, path)
}

/**
 * A request sent from the page through the preload's bridge, as the renderer sends it,
 * and main's reply narrowed here. null when the page has no bridge or main answered
 * something that is not a reply.
 */
export const requestFromPage = async ({
  page,
  request,
}: {
  page: Page
  request: Record<string, string>
}): Promise<DesktopReply | null> => {
  const reply = await page.evaluate(async (sent) => {
    if (!('ravenDesktop' in window)) return null
    const bridge = window.ravenDesktop
    if (typeof bridge !== 'object' || bridge === null || !('request' in bridge)) return null
    if (typeof bridge.request !== 'function') return null
    const answer: unknown = await bridge.request(sent)
    return answer
  }, request)
  return isDesktopReply(reply) ? reply : null
}
