/**
 * The quit budget mark (spec Review Focus 5): `raven-quit-ms` from the first `before-quit`
 * to the first `will-quit` (every window closed, mpv stopped, the stores written) or the
 * quit gate giving up, written once to the log, and on stdout unpackaged (Ruling 13).
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
