/** `log` that never throws: a log line must not fail, or turn into a rejection, what it describes. */
export const quietly =
  (log: (message: string) => void) =>
  (message: string): void => {
    try {
      log(message)
    } catch {
      // Nothing is left to tell.
    }
  }
