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
 * How long quitting waits on the log, last. A disk that never answers must not hold the
 * quit, and this fits in `QUIT_FLUSH_MS` after mpv's `DESTROY_MS`.
 */
export const LOG_FLUSH_MS = 250

/**
 * Ends the process once the log has written what it holds, or after `LOG_FLUSH_MS`: an
 * ending that runs no `will-quit` (the quit gate giving up, a failed start) would lose its
 * last lines, which say why.
 */
export const endAfterLog = async ({
  log,
  wait,
  end,
}: {
  log: { flush: () => Promise<void> }
  wait: (ms: number) => Promise<void>
  end: () => void
}): Promise<void> => {
  await Promise.race([log.flush(), wait(LOG_FLUSH_MS)]).catch(() => undefined)
  end()
}

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
 * What quitting waits on, in the order it must happen: mpv stops while the saves in
 * flight to a server finish, so nothing it plays outlives the stores it would report
 * into, then every store writes. Each is given `DESTROY_MS`, so the stores still write
 * within the quit gate's bound. The log writes last, so what went wrong before it is in
 * it; it is given `LOG_FLUSH_MS` and, once it misses that, no longer holds the quit.
 */
export const createShutdown = ({
  engine,
  stores,
  writes,
  log,
  warn,
  wait,
}: {
  engine: { isAlive: () => boolean; destroy: () => Promise<void> }
  stores: readonly { isDirty: () => boolean; flush: () => Promise<void> }[]
  writes: { hasPending: () => boolean; settle: () => Promise<void> }
  log: { isDirty: () => boolean; flush: () => Promise<void> }
  warn: (message: string) => void
  wait: (ms: number) => Promise<void>
}): { isPending: () => boolean; settle: () => Promise<void> } => {
  // Once mpv or the saves have missed their deadline, a later settle (the quit gate's
  // second attempt) goes straight to the stores rather than waiting on them again.
  let hasTimedOut = false
  let hasWritesTimedOut = false
  let hasLogTimedOut = false

  const hasPendingWrites = () => !hasWritesTimedOut && writes.hasPending()
  const hasPendingLog = () => !hasLogTimedOut && log.isDirty()

  const isPending = () =>
    engine.isAlive() ||
    hasPendingWrites() ||
    stores.some((store) => store.isDirty()) ||
    hasPendingLog()

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

  const settleWrites = async () => {
    if (!hasPendingWrites()) return
    const outcome = await Promise.race([
      writes.settle().then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      wait(DESTROY_MS).then(() => 'timedOut' as const),
    ])
    if (outcome !== 'timedOut') return
    hasWritesTimedOut = true
    warn(`raven player's saves to a server did not finish within ${DESTROY_MS} ms.`)
  }

  const flushLog = async () => {
    if (!hasPendingLog()) return
    const outcome = await Promise.race([
      log.flush().then(
        () => 'flushed' as const,
        () => 'flushed' as const,
      ),
      wait(LOG_FLUSH_MS).then(() => 'timedOut' as const),
    ])
    if (outcome !== 'timedOut') return
    hasLogTimedOut = true
    warn(`raven player's log did not write within ${LOG_FLUSH_MS} ms.`)
  }

  const settle = async () => {
    await Promise.all([stopEngine(), settleWrites()])
    await Promise.all(stores.map((store) => store.flush()))
    await flushLog()
  }

  return { isPending, settle }
}
