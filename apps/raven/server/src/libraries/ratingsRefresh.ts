import { Inject, Injectable, Logger } from '@nestjs/common'
import type { RatingsRefresh as RatingsRefreshStatus } from '@raven/core'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { ScoreSweep } from '@/metadata/scoreSweep'
import { ScoresRepository } from '@/metadata/scoresRepository'
import { ScannerService } from '@/scanner/scannerService'

type RatingsRefreshStartProps = { libraryId: number; since?: string }

type RatingsRefreshAfterQuickScanProps = {
  libraryId: number
  since: string
  job: { isCancelled: boolean }
}

/**
 * A library's ratings: Update ratings asks for the score of every movie and
 * show that has none from the source the library shows, and a quick scan
 * asks for the scores of the titles it added once they are matched. Both are
 * fetched by the score sweep, past the 30-day wait. What was asked for is
 * kept in the database, so a restart carries on where it left off.
 */
@Injectable()
export class RatingsRefresh {
  private readonly logger = new Logger(RatingsRefresh.name)

  /** The quick scans the admin started that have yet to hand their new titles to the sweep. */
  private readonly quickScans = new Map<number, { isCancelled: boolean }>()

  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(ScoresRepository) private readonly scores: ScoresRepository,
    @Inject(ScannerService)
    private readonly scanner: Pick<ScannerService, 'quickScanNow' | 'whenIdle' | 'cancel'>,
    @Inject(ScoreSweep)
    private readonly scoreSweep: Pick<ScoreSweep, 'kick' | 'canSettle' | 'requestsPause'>,
  ) {}

  /**
   * Asks for the scores of the library's titles that have none, adding to an
   * update under way, and wakes the sweep. With no source that could ever
   * settle a request it asks for nothing, and so does a library with no
   * unrated titles: either finishes at once.
   */
  start({ libraryId, since = '' }: RatingsRefreshStartProps): void {
    const at = new Date().toISOString()
    // An update whose last title left outside the sweep is over, so this one starts anew.
    this.libraries.finishRatingsRefreshes(at)
    this.libraries.startRatingsRefresh({
      id: libraryId,
      at,
      shouldAsk: this.scoreSweep.canSettle(),
      since,
    })
    this.scoreSweep.kick()
  }

  /**
   * A quick scan for what is new, which asks for the scores of the titles it
   * added once they are matched. Cancelling it, or the library going, stops
   * the scores being asked for.
   */
  quickScan(libraryId: number): void {
    const since = new Date().toISOString()
    const job = { isCancelled: false }
    this.quickScans.set(libraryId, job)
    this.scanner.quickScanNow(libraryId)
    this.afterQuickScan({ libraryId, since, job }).catch((error: unknown) =>
      this.logger.warn(error instanceof Error ? error.message : String(error)),
    )
  }

  private async afterQuickScan({
    libraryId,
    since,
    job,
  }: RatingsRefreshAfterQuickScanProps): Promise<void> {
    await this.scanner.whenIdle(libraryId)
    if (this.quickScans.get(libraryId) === job) this.quickScans.delete(libraryId)
    if (job.isCancelled || !this.libraries.get(libraryId)) return
    this.start({ libraryId, since })
  }

  /** Stops a quick scan the admin started, and the scores that would follow it. */
  cancelQuickScan(libraryId: number): void {
    const job = this.quickScans.get(libraryId)
    if (job) job.isCancelled = true
    this.scanner.cancel(libraryId)
  }

  /**
   * Cancels Update ratings: the titles it still waits on are not asked for,
   * and it is over as of now. Scores already fetched stay.
   */
  cancel(libraryId: number): void {
    this.scores.clearLibraryRequests(libraryId)
    this.libraries.finishRatingsRefreshes(new Date().toISOString())
  }

  /**
   * Where the library's Refresh stands, and why it waits when it does. One
   * whose last title left outside the sweep (the title deleted, or its
   * scores fetched by Refresh details) finishes here.
   */
  status(libraryId: number): RatingsRefreshStatus {
    const { startedAt, total, finishedAt } = this.libraries.ratingsRefresh(libraryId)
    if (startedAt == null) return { state: 'idle', finishedAt }
    const left = this.scores.requestsLeft(libraryId)
    if (left === 0) {
      const at = new Date().toISOString()
      this.libraries.finishRatingsRefreshes(at)
      return { state: 'idle', finishedAt: at }
    }
    const progress = { done: Math.max(0, total - left), total, startedAt }
    const pause = this.scoreSweep.requestsPause()
    return pause == null
      ? { state: 'running', ...progress }
      : { state: 'waiting', ...progress, ...pause }
  }
}
