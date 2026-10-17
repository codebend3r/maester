import { messageOf } from '@/shared/messageOf'

/** How long a quit waits on mpv and the stores before it gives up on them. */
export const QUIT_FLUSH_MS = 1000

/**
 * How long quitting waits on mpv before the stores write anyway. mpv can hang for good
 * (a CoreAudio device that never answers holds its core thread), so this leaves the rest
 * of `QUIT_FLUSH_MS` for the stores.
 */
export const DESTROY_MS = 500

/**
 * How a quit that gave up ends. Node's teardown waits for the addon's destroy worker, so
 * with mpv still alive `app.exit` would never return and only killing the process ends
 * it. The kill skips Chromium's own shutdown (the page's last localStorage writes, such
 * as its player preferences, can be lost) and the process exits with 137.
 */
export const hardExitFor = ({ isEngineAlive }: { isEngineAlive: boolean }): 'kill' | 'exit' =>
  isEngineAlive ? 'kill' : 'exit'

/**
 * What a window close does once it stops waiting on mpv. With mpv alive, disposing the
 * window would pull its surface away and skip the stores, so the app quits instead and
 * its own gate flushes them; with mpv gone the window can go.
 */
export const closeTimeoutFor = ({
  isEngineAlive,
}: {
  isEngineAlive: boolean
}): 'quitApp' | 'destroyWindow' => (isEngineAlive ? 'quitApp' : 'destroyWindow')

/**
 * What quitting waits on, in the order it must happen: mpv stops first, so nothing it
 * plays outlives the stores it would report into, then every store writes.
 */
export const createShutdown = ({
  engine,
  stores,
  warn,
  wait,
}: {
  engine: { isAlive: () => boolean; destroy: () => Promise<void> }
  stores: readonly { isDirty: () => boolean; flush: () => Promise<void> }[]
  warn: (message: string) => void
  wait: (ms: number) => Promise<void>
}): { isPending: () => boolean; settle: () => Promise<void> } => {
  // Once mpv has missed its deadline, a later settle (the quit gate's second attempt)
  // goes straight to the stores rather than waiting on it again.
  let hasTimedOut = false

  const isPending = () => engine.isAlive() || stores.some((store) => store.isDirty())

  const stopEngine = async () => {
    if (hasTimedOut || !engine.isAlive()) return
    const outcome = await Promise.race([
      engine.destroy().then(
        () => 'stopped' as const,
        (error: unknown) => {
          warn(`raven player could not stop its video engine: ${messageOf(error)}`)
          return 'failed' as const
        },
      ),
      wait(DESTROY_MS).then(() => 'timedOut' as const),
    ])
    if (outcome !== 'timedOut') return
    hasTimedOut = true
    warn(`raven player's video engine did not stop within ${DESTROY_MS} ms.`)
  }

  const settle = async () => {
    await stopEngine()
    await Promise.all(stores.map((store) => store.flush()))
  }

  return { isPending, settle }
}
