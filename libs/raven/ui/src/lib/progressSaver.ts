import type { ProgressReport } from '@raven/core'

/** How long to wait before each retry of a save that did not land: about half a minute in all. */
export const SAVE_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type ProgressSaver = {
  /** Asks for `report` to reach the server; a newer report replaces one not yet sent. */
  save: (report: ProgressReport) => void
  /** Settles once every position asked for has been sent or given up on; it never rejects. */
  settled: () => Promise<void>
}

type CreateProgressSaverProps = {
  send: (report: ProgressReport) => Promise<unknown>
  wait?: (ms: number) => Promise<void>
}

/**
 * Sends a title's saved positions one at a time, only the newest of those
 * waiting, so an older spot never lands after a newer one. A save that
 * fails, as when the connection drops along with the video, is tried again
 * on `SAVE_RETRY_MS` unless a newer position replaced it by then; `settled`
 * lets a host read the server's lists again only once the last position is in.
 */
export const createProgressSaver = ({
  send,
  wait = sleep,
}: CreateProgressSaverProps): ProgressSaver => {
  let wanted: ProgressReport | null = null
  let running: Promise<void> | null = null

  type DrainProps = { failures: number }

  const drain = async ({ failures }: DrainProps): Promise<void> => {
    const report = wanted
    if (report === null) {
      running = null
      return
    }
    wanted = null
    try {
      await send(report)
      return drain({ failures: 0 })
    } catch {
      const delay = SAVE_RETRY_MS[failures]
      // Given up on, it leaves only a newer position, if one came, to send.
      if (delay === undefined) return drain({ failures: 0 })
      wanted ??= report
      await wait(delay)
      return drain({ failures: failures + 1 })
    }
  }

  return {
    save: (report) => {
      wanted = report
      running ??= drain({ failures: 0 })
    },
    settled: () => running ?? Promise.resolve(),
  }
}
