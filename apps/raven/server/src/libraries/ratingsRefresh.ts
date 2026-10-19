import { Inject, Injectable } from '@nestjs/common'
import type { RatingsRefresh as RatingsRefreshStatus } from '@raven/core'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { ScoreSweep } from '@/metadata/scoreSweep'
import { ScannerService } from '@/scanner/scannerService'

/**
 * A library's Refresh: a quick scan for new files, and every movie's and
 * show's IMDb, Rotten Tomatoes, Metacritic and TMDB scores fetched again,
 * past the 30-day wait, by the score sweep. What it asked for is kept in the
 * database, so a restart carries on where it left off.
 */
@Injectable()
export class RatingsRefresh {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ScannerService) private readonly scanner: Pick<ScannerService, 'quickScan'>,
    @Inject(ScoreSweep)
    private readonly scoreSweep: Pick<ScoreSweep, 'kick' | 'canSettle' | 'requestsPause'>,
  ) {}

  /**
   * Asks for the library's titles unless a Refresh of it is under way, which
   * keeps its count, then quick-scans the library and wakes the sweep. One
   * whose last title has gone counts as over, so a press then starts anew.
   * With no source that could ever settle a request, it asks for nothing,
   * and so does a library with no titles: either finishes at once.
   */
  start(libraryId: number): void {
    const at = new Date().toISOString()
    this.libraries.finishRatingsRefreshes(at)
    if (this.libraries.ratingsRefresh(libraryId).startedAt == null) {
      this.libraries.startRatingsRefresh({
        id: libraryId,
        at,
        shouldAsk: this.scoreSweep.canSettle(),
      })
    }
    this.scanner.quickScan(libraryId)
    this.scoreSweep.kick()
  }

  /**
   * Where the library's Refresh stands, and why it waits when it does. One
   * whose last title left outside the sweep (the title deleted, or its
   * scores fetched by Refresh details) finishes here.
   */
  status(libraryId: number): RatingsRefreshStatus {
    const { startedAt, total, finishedAt } = this.libraries.ratingsRefresh(libraryId)
    if (startedAt == null) return { state: 'idle', finishedAt }
    const left = this.metadata.requestsLeft(libraryId)
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
