/**
 * The quit budget mark (spec Review Focus 5): `raven-quit-ms` from the first `before-quit`
 * to just before the process ends, printed once, on stdout until the log lands.
 */
export const createQuitMark = ({
  isEnabled,
  now,
  write,
}: {
  isEnabled: boolean
  now: () => number
  write: (line: string) => void
}) => {
  const quit: { startedAt: number | null; hasEnded: boolean } = {
    startedAt: null,
    hasEnded: false,
  }
  return {
    /** The quit gate cancels and repeats `before-quit`; only the first one starts the clock. */
    started: () => {
      if (quit.startedAt !== null) return
      quit.startedAt = now()
    },
    ended: () => {
      const { startedAt } = quit
      if (!isEnabled || startedAt === null || quit.hasEnded) return
      quit.hasEnded = true
      write(`raven-quit-ms ${Math.round(now() - startedAt)}\n`)
    },
  }
}
