import type { Logger } from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { TMDB_ERROR_KINDS, TmdbError } from '@/metadata/tmdbClient'

/** How many files, shows or items a pass works on at once; TMDB's own limit spaces the calls. */
export const PASS_CONCURRENCY = 4

/** Whether a TMDB failure means the rest of a pass should wait for the next one. */
const stopsThePass = (error: unknown): boolean =>
  error instanceof TmdbError &&
  (error.kind === TMDB_ERROR_KINDS.unavailable || error.kind === TMDB_ERROR_KINDS.unauthorized)

type GuardState = { stopped: false } | { stopped: true; error: unknown }

/**
 * Runs the tasks of one pass over TMDB, a matching pass or the sweep: a task
 * that fails is logged and the rest go on, while TMDB going away (down, or
 * the token refused) stops every task after it until the next pass.
 */
export class PassGuard {
  private state: GuardState = { stopped: false }

  constructor(
    private readonly options: {
      logger: Logger
      /** Logged before a task's own failure: `Could not match`. */
      failed: string
      /** Logged once when TMDB stopped the pass: `Matching stopped for now`. */
      stopped: string
    },
  ) {}

  get isStopped(): boolean {
    return this.state.stopped
  }

  async run(task: () => Promise<unknown>): Promise<void> {
    if (this.state.stopped) return
    try {
      await task()
    } catch (error) {
      if (stopsThePass(error)) {
        this.state = { stopped: true, error }
        return
      }
      this.options.logger.warn(`${this.options.failed}: ${errorMessage(error)}`)
    }
  }

  /** Logs why the pass stopped, when it did. */
  reportStop(): void {
    if (!this.state.stopped) return
    this.options.logger.warn(`${this.options.stopped}: ${errorMessage(this.state.error)}`)
  }
}
