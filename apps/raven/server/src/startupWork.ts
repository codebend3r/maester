import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { errorMessage } from '@/errorMessage'

/** The DI token for whether the boot's own work waits for `main.ts` to say the server listens. */
export const STARTUP_HELD = Symbol('STARTUP_HELD')

/**
 * How long the event loop idles between one step and the next. A request
 * takes several turns of the loop to answer; with no gap, each of its turns
 * would wait out a step of its own.
 */
const STEP_GAP_MS = 50

const gap = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, STEP_GAP_MS))

/**
 * The work the server does on boot: the quick scans, the metadata passes
 * and the item sweep. Each step reads the index synchronously, a whole
 * library at a time, which on a cold disk takes minutes in all; run in the
 * bootstrap hooks, before the server listened, it left every request
 * unanswered for that long after a restart.
 *
 * So the steps wait until the server listens (`main.ts` calls `release`; a
 * test's app, which never listens, holds nothing), then run in the order
 * added with a short gap before each, and requests are answered between one
 * library and the next.
 */
@Injectable()
export class StartupWork implements OnModuleDestroy {
  private readonly logger = new Logger(StartupWork.name)
  private open: () => void = () => undefined
  private tail: Promise<void>
  private isClosed = false

  constructor(@Inject(STARTUP_HELD) isHeld: boolean) {
    this.tail = isHeld
      ? new Promise<void>((resolve) => {
          this.open = resolve
        })
      : Promise.resolve()
  }

  /** The server listens: the steps added so far, and any added later, may run. */
  release(): void {
    this.open()
  }

  /** The database closes with the app, so a step still waiting then never runs. */
  onModuleDestroy(): void {
    this.isClosed = true
  }

  /** Queues `steps` to run in order, a gap apart, after every step added before them. */
  add(steps: ReadonlyArray<() => void>): void {
    this.tail = steps.reduce(
      (before, step) => before.then(gap).then(() => this.runStep(step)),
      this.tail,
    )
  }

  /** Resolves once every step added so far has run. */
  whenDone(): Promise<void> {
    return this.tail
  }

  /** A step that throws is logged, and the next still runs. */
  private runStep(step: () => void): void {
    if (this.isClosed) return
    try {
      step()
    } catch (error) {
      this.logger.error(`A step of the work on boot failed: ${errorMessage(error)}`)
    }
  }
}
