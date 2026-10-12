/** Wrong tries in a row before trying waits, and how long it waits. */
const TRIES = 5
const WAIT_MS = 60_000

/**
 * Counts wrong guesses at a secret: five in a row make the next try wait a
 * minute, so a short PIN is not quickly run through.
 */
export class WrongTries {
  private failed = 0
  private waitUntil = 0

  get isWaiting(): boolean {
    return Date.now() < this.waitUntil
  }

  fail(): void {
    this.failed += 1
    if (this.failed < TRIES) return
    this.failed = 0
    this.waitUntil = Date.now() + WAIT_MS
  }

  succeed(): void {
    this.failed = 0
  }
}
