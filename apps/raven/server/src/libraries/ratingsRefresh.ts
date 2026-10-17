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
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(ScoreSweep) private readonly scoreSweep: ScoreSweep,
  ) {}

  /**
   * Asks for the library's titles unless a Refresh of it is under way, which
   * keeps its count, then quick-scans the library and wakes the sweep. A
   * library with no titles finishes at once.
   */
  start(libraryId: number): void {
    if (this.libraries.ratingsRefresh(libraryId).startedAt == null) {
      const at = new Date().toISOString()
      const total = this.metadata.requestScores(libraryId)
      this.libraries.startRatingsRefresh({ id: libraryId, at, total })
      if (total === 0) this.libraries.finishRatingsRefreshes(at)
    }
    this.scanner.quickScan(libraryId)
    this.scoreSweep.kick()
  }

  /** Where the library's Refresh stands, and why it waits when it does. */
  status(libraryId: number): RatingsRefreshStatus {
    const { startedAt, total, finishedAt } = this.libraries.ratingsRefresh(libraryId)
    if (startedAt == null) return { state: 'idle', finishedAt }
    const left = this.metadata.requestsLeft(libraryId)
    const progress = { done: Math.max(0, total - left), total, startedAt }
    const pause = this.scoreSweep.requestsPause()
    return pause == null
      ? { state: 'running', ...progress }
      : { state: 'waiting', ...progress, ...pause }
  }
}
