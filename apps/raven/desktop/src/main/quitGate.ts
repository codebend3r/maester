/**
 * Holds a quit until the state store has written, for at most `timeoutMs`: a hung
 * or failed write must never keep the app open. The store does not retry a failed
 * write, so this flush is the last chance to save. A save that lands while it writes
 * leaves the store dirty after a flush that finished, so that case flushes once more
 * within the same bound. Used for `before-quit` and `will-quit` both, since the page's
 * last save can land between them.
 */
export const createQuitGate = ({
  isDirty,
  flush,
  timeoutMs,
  quit,
  exit,
  wait,
}: {
  isDirty: () => boolean
  flush: () => Promise<void>
  timeoutMs: number
  quit: () => void
  exit: () => void
  wait: (ms: number) => Promise<void>
}): ((event: { preventDefault: () => void }) => void) => {
  let isFlushing = false

  const save = async (): Promise<void> => {
    const deadline = wait(timeoutMs).then(() => 'timedOut' as const)
    const attempt = () =>
      Promise.race([
        flush().then(
          () => 'flushed' as const,
          () => 'failed' as const,
        ),
        deadline,
      ])
    if ((await attempt()) === 'flushed' && isDirty()) await attempt()
    isFlushing = false
    if (isDirty()) {
      exit()
      return
    }
    quit()
  }

  return (event) => {
    if (!isDirty()) return
    event.preventDefault()
    if (isFlushing) return
    isFlushing = true
    save().catch(() => {
      isFlushing = false
      exit()
    })
  }
}
