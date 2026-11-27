import type { ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { ElectronApplication } from '@playwright/test'

const QUIT_OUTCOMES = { closed: 'closed', timeout: 'timeout' } as const
const REMOVE_RETRY_MS = 250
const BROWSER_OPENS_KEY = 'e2eBrowserOpens'

type AppProps = { app: ElectronApplication }

/** Whether the app's process has exited or been killed by a signal. */
export const hasExited = (app: ElectronApplication): boolean => {
  const child = app.process()
  return child.exitCode !== null || child.signalCode !== null
}

type RemoveFolderProps = {
  path: string
  /**
   * How often a removal the system refuses is tried again, none by default. Node waits 250 ms
   * longer before each try, so 8 of them can take 9 seconds in all.
   */
  maxRetries?: number
}

// A hook that failed before it made its folder leaves the path empty, which is not a folder to remove.
export const removeFolder = async ({ path, maxRetries = 0 }: RemoveFolderProps): Promise<void> => {
  if (path === '') return
  await rm(path, { recursive: true, force: true, maxRetries, retryDelay: REMOVE_RETRY_MS })
}

type ChildProps = { child: ChildProcess }

const killChild = async ({ child }: ChildProps): Promise<void> => {
  child.kill('SIGKILL')
}

type QuitWithinProps = AppProps & {
  /** How long the quit may take; one that takes longer is a bug, not a slow test. */
  ms: number
  /** What the error calls the app. */
  name: string
  /** Ends an app that would not quit; SIGKILL by default. */
  forceEnd?: (input: ChildProps) => Promise<void>
}

/** Quits the app as a person would and waits for its process to end, ending it by force past `ms`. */
export const quitWithin = async ({
  app,
  ms,
  name,
  forceEnd = killChild,
}: QuitWithinProps): Promise<void> => {
  if (hasExited(app)) return
  const deadline = new AbortController()
  const outcome = await Promise.race([
    app.close().then(() => QUIT_OUTCOMES.closed),
    delay(ms, QUIT_OUTCOMES.timeout, { signal: deadline.signal }),
  ])
  deadline.abort()
  if (outcome === QUIT_OUTCOMES.closed) return
  await forceEnd({ child: app.process() })
  throw new Error(`${name} did not quit within ${ms} ms.`)
}

type WithLaunchedProps<Launched extends AppProps, Result> = {
  launch: () => Promise<Launched>
  close: (input: AppProps) => Promise<void>
  run: (launched: Launched) => Promise<Result>
}

/** Launches an app, runs `run` against it and always quits it after, so no process outlives a test. */
export const withLaunched = async <Launched extends AppProps, Result>({
  launch,
  close,
  run,
}: WithLaunchedProps<Launched, Result>): Promise<Result> => {
  const launched = await launch()
  const result = await run(launched).catch(async (error: unknown) => {
    await close({ app: launched.app }).catch(() => undefined)
    throw error
  })
  await close({ app: launched.app })
  return result
}

/**
 * Records what main hands the browser instead of opening it. main reads `shell.openExternal`
 * at each call, so the stand-in takes its place.
 */
export const stubBrowser = async ({ app }: AppProps): Promise<void> => {
  await app.evaluate(({ shell }, key) => {
    Reflect.set(globalThis, key, [])
    const open = async (...args: unknown[]) => {
      const [url] = args
      const opened: unknown = Reflect.get(globalThis, key)
      const earlier = Array.isArray(opened)
        ? opened.filter((item): item is string => typeof item === 'string')
        : []
      Reflect.set(globalThis, key, [...earlier, typeof url === 'string' ? url : ''])
    }
    Reflect.set(shell, 'openExternal', open)
  }, BROWSER_OPENS_KEY)
}

/** What main handed the browser since `stubBrowser`, in order. */
export const browserOpens = async ({ app }: AppProps): Promise<string[]> => {
  const opened = await app.evaluate((_modules, key) => {
    const value: unknown = Reflect.get(globalThis, key)
    return value
  }, BROWSER_OPENS_KEY)
  return Array.isArray(opened)
    ? opened.filter((item): item is string => typeof item === 'string')
    : []
}
