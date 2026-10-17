import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { type DesktopReply, isDesktopReply } from '@/shared/protocol'

// `cwd` with `args: ['.']` runs the built app the way `electron .` does: package.json's `main`.
const PROJECT_DIR = join(import.meta.dirname, '..')
// A quit that hangs is a bug (the quit gate gives up flushing after a second), not a slow test.
const QUIT_MS = 10_000
// Every budget mark main prints on stdout (Ruling 14): `raven-<name> <n>` on a line of its own.
const MARK_LINE = /^raven-([a-z][a-z0-9-]*) (\d+)$/

/** The marks main has printed so far, in order, and whether its stdout has closed. */
export type Marks = {
  seen: ReadonlyArray<{ name: string; value: number }>
  isClosed: boolean
  /** Calls `listener` on every mark and on close, until the returned function is called. */
  watch: (listener: () => void) => () => void
}

export type Launched = {
  app: ElectronApplication
  page: Page
  marks: Marks
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
// so the window, and every mark printed from then on, come after.
const readMarks = (app: ElectronApplication): Marks => {
  const listeners = new Set<() => void>()
  const marks = {
    seen: new Array<{ name: string; value: number }>(),
    isClosed: false,
    watch: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const tell = () => [...listeners].forEach((listener) => listener())
  const { stdout } = app.process()
  if (stdout === null) {
    marks.isClosed = true
    return marks
  }
  const lines = createInterface({ input: stdout })
  lines.on('line', (line) => {
    const match = MARK_LINE.exec(line)
    if (match === null) return
    const [, name = '', value = ''] = match
    marks.seen.push({ name, value: Number(value) })
    tell()
  })
  lines.once('close', () => {
    marks.isClosed = true
    tell()
  })
  return marks
}

/**
 * The first `raven-<name>` mark main printed in this run, waiting up to `ms` for it, and
 * failing with a clear error when it has not come or the app quit first.
 */
export const markWithin = ({
  launched: { marks },
  name,
  ms,
}: {
  launched: Launched
  name: string
  ms: number
}): Promise<number> =>
  new Promise((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer)
      unwatch()
      finish()
    }
    const check = () => {
      const found = marks.seen.find((mark) => mark.name === name)
      if (found !== undefined) return settle(() => resolve(found.value))
      if (!marks.isClosed) return
      settle(() => reject(new Error(`raven player quit before printing its ${name} mark.`)))
    }
    const timer = setTimeout(() => {
      settle(() => reject(new Error(`raven player's ${name} mark was not seen within ${ms} ms.`)))
    }, ms)
    const unwatch = marks.watch(check)
    check()
  })

/** main's launch mark, printed at ready-to-show, so it is never far behind the window. */
export const launchMarkWithin = ({ launched, ms }: { launched: Launched; ms: number }) =>
  markWithin({ launched, name: 'launch-ms', ms })

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

/** Headless mpv (`vo=null`, `ao=null`), or none, which is the html fallback's run (Ruling 15). */
export type MpvMode = 'headless' | 'off'

export const launchApp = async ({
  userData,
  mpv = 'headless',
}: {
  userData: string
  mpv?: MpvMode
}): Promise<Launched> => {
  const app = await _electron.launch({
    // Chromium's fake audio sink: playback is clocked by the audio output, so a real device
    // whose clock has stalled (an asleep USB interface) would freeze `currentTime` at 0.
    args: ['--disable-audio-output', '.'],
    cwd: PROJECT_DIR,
    // e2e never drives the window surface (Ruling 15).
    env: { ...process.env, RAVEN_DESKTOP_USER_DATA: userData, RAVEN_DESKTOP_MPV: mpv },
  })
  const marks = readMarks(app)
  const page = await app.firstWindow().catch(async (error: unknown) => {
    await closeApp({ app }).catch(() => undefined)
    throw error
  })
  return { app, page, marks }
}

/** Launches the app, runs `run` against it and always quits it after, so no process outlives a test. */
export const withApp = async <T>({
  userData,
  mpv,
  run,
}: {
  userData: string
  mpv?: MpvMode
  run: (launched: Launched) => Promise<T>
}): Promise<T> => {
  const launched = await launchApp({ userData, mpv })
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

/** The share of `label` main has stored as watched, in whole percent, as Home labels it. */
export const watchedPercent = async ({
  page,
  label,
}: {
  page: Page
  label: string
}): Promise<number | null> => {
  const reply = await requestFromPage({ page, request: { type: 'listRecents' } })
  if (reply === null || reply.type !== 'recents') return null
  const recent = reply.recents.find((entry) => entry.label === label)
  if (recent === undefined || recent.watched === null) return null
  return Math.round(recent.watched * 100)
}
