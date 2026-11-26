import { ACCOUNT_DATA_REFRESH_MS } from '@raven/core'

import { IGNORED } from '@/lib/ignore'
import type { AppActivity } from '@/servers/eventSource'

type RepeatProps = { run: () => void; ms: number }

type KeepSyncedProps = {
  /** Reads the account's list again; a read that fails waits for the next. */
  sync: () => Promise<unknown>
  app: AppActivity
  /** Runs `run` every `ms` until the function it hands back stops it. */
  repeat: (props: RepeatProps) => () => void
}

/**
 * Keeps the account's servers and their names in step with its other devices: read every
 * `ACCOUNT_DATA_REFRESH_MS` while the app is in front, never in the background, and at once on
 * coming back from it, so a rename made on the web or another device shows without a relaunch.
 * Hands back the way to stop.
 */
export const keepSynced = ({ sync, app, repeat }: KeepSyncedProps): (() => void) => {
  let stopRepeating: (() => void) | null = null
  const run = () => {
    sync().catch(IGNORED)
  }
  const start = () => {
    stopRepeating = repeat({ run, ms: ACCOUNT_DATA_REFRESH_MS })
  }
  const stop = () => {
    stopRepeating?.()
    stopRepeating = null
  }
  if (app.isForeground()) start()
  const unwatch = app.watch((isForeground) => {
    if (!isForeground) {
      stop()
      return
    }
    // `inactive` and back again is still the front: only a return from the background reads.
    if (stopRepeating !== null) return
    run()
    start()
  })
  return () => {
    unwatch()
    stop()
  }
}
